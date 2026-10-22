import {
  IConfigComponent,
  STOP_COMPONENT,
} from '@well-known-components/interfaces'
import future, { IFuture } from 'fp-future'
import {
  createRenderLimiter,
  createRenderLimiterComponent,
} from '../../src/modules/render-limiter/component'
import { RenderBusyError } from '../../src/modules/render-limiter/errors'
import { IRenderLimiterComponent } from '../../src/modules/render-limiter/types'

function blockFor(ms: number): void {
  const end = Date.now() + ms
  while (Date.now() < end) {
    // synchronous work, like a canvas draw and encode
  }
}

describe('when running renders through the render limiter', () => {
  let limiter: IRenderLimiterComponent
  let firstRender: IFuture<string>
  let firstRun: Promise<string>
  let secondTask: jest.Mock

  beforeEach(() => {
    // setImmediate stays real: the limiter yields through it between renders
    jest.useFakeTimers({ doNotFake: ['setImmediate'] })
    limiter = createRenderLimiter({
      maxConcurrent: 1,
      maxQueued: 1,
      maxWaitMs: 1000,
    })
    firstRender = future<string>()
    firstRun = limiter.run(() => firstRender)
    secondTask = jest.fn().mockResolvedValue('second')
  })

  afterEach(async () => {
    firstRender.resolve('first')
    await firstRun.catch(() => undefined)
    jest.useRealTimers()
  })

  describe('and a slot is free', () => {
    beforeEach(() => {
      firstRender.resolve('first')
    })

    it("should resolve with the task's result", async () => {
      await expect(firstRun).resolves.toBe('first')
    })
  })

  describe('and every slot is busy', () => {
    let secondRun: Promise<string>

    beforeEach(() => {
      secondRun = limiter.run(secondTask)
    })

    afterEach(async () => {
      firstRender.resolve('first')
      await secondRun.catch(() => undefined)
    })

    it('should not start the queued task', () => {
      expect(secondTask).not.toHaveBeenCalled()
    })

    describe('and the running render finishes', () => {
      beforeEach(async () => {
        firstRender.resolve('first')
        await firstRun
      })

      it('should run the queued task', async () => {
        await expect(secondRun).resolves.toBe('second')
      })
    })

    describe('and the running render does not finish within the maximum wait', () => {
      beforeEach(() => {
        jest.advanceTimersByTime(1000)
      })

      it('should reject the queued task with a timeout error', async () => {
        await expect(secondRun).rejects.toThrow(
          new RenderBusyError(
            'Timed out after 1000ms waiting for a map render slot'
          )
        )
      })
    })

    describe('and the slot frees up after the queued task deadline but before its timer fires', () => {
      beforeEach(async () => {
        jest.setSystemTime(Date.now() + 1000)
        firstRender.resolve('first')
        await firstRun
        await secondRun.catch(() => undefined)
      })

      it('should reject the queued task with a timeout error', async () => {
        await expect(secondRun).rejects.toThrow(
          new RenderBusyError(
            'Timed out after 1000ms waiting for a map render slot'
          )
        )
      })

      it('should not run the queued task', () => {
        expect(secondTask).not.toHaveBeenCalled()
      })
    })

    describe('and the queue is full', () => {
      let thirdRun: Promise<string>

      beforeEach(() => {
        thirdRun = limiter.run(secondTask)
      })

      it('should reject the new task right away with a busy error', async () => {
        await expect(thirdRun).rejects.toThrow(
          new RenderBusyError('Too many map renders queued')
        )
      })
    })

    describe('and the limiter is stopped', () => {
      beforeEach(async () => {
        await limiter[STOP_COMPONENT]!()
      })

      it('should reject the queued task with a busy error', async () => {
        await expect(secondRun).rejects.toThrow(RenderBusyError)
      })
    })
  })

  describe('and the running render fails', () => {
    let secondRun: Promise<string>

    beforeEach(async () => {
      secondRun = limiter.run(secondTask)
      firstRender.reject(new Error('render failed'))
      await firstRun.catch(() => undefined)
    })

    it('should free its slot for the queued task', async () => {
      await expect(secondRun).resolves.toBe('second')
    })
  })
})

describe('when several synchronous renders are queued', () => {
  let limiter: IRenderLimiterComponent
  let events: string[]
  let interval: NodeJS.Timeout

  beforeEach(async () => {
    events = []
    limiter = createRenderLimiter({
      maxConcurrent: 1,
      maxQueued: 3,
      maxWaitMs: 5000,
    })
    interval = setInterval(() => events.push('tick'), 1)
    const render = (id: number) => async () => {
      blockFor(20)
      events.push(`render${id}`)
    }
    await new Promise<void>((resolve, reject) =>
      setImmediate(() => {
        Promise.all([1, 2, 3].map((id) => limiter.run(render(id))))
          .then(() => resolve())
          .catch(reject)
      })
    )
  })

  afterEach(() => {
    clearInterval(interval)
  })

  it('should let timers run between one render and the next', () => {
    const firstRender = events.indexOf('render1')
    const lastRender = events.indexOf('render3')
    expect(
      events
        .slice(firstRender, lastRender + 1)
        .filter((event, i, all) => event !== 'tick' || all[i - 1] !== 'tick')
    ).toEqual(['render1', 'tick', 'render2', 'tick', 'render3'])
  })
})

describe('when creating the render limiter from config', () => {
  let values: Record<string, string | undefined>
  let warn: jest.Mock
  let limiter: IRenderLimiterComponent

  beforeEach(async () => {
    warn = jest.fn()
    values = { RENDER_MAX_CONCURRENCY: '0', RENDER_MAX_QUEUED: 'abc' }
    limiter = await createRenderLimiterComponent({
      config: {
        getString: jest.fn(async (name: string) => values[name]),
      } as unknown as IConfigComponent,
      logs: {
        getLogger: () => ({
          warn,
          info: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
          log: jest.fn(),
        }),
      },
    })
  })

  it('should warn about every value that is not a positive integer', () => {
    expect(warn.mock.calls.map(([, context]) => context.name)).toEqual([
      'RENDER_MAX_CONCURRENCY',
      'RENDER_MAX_QUEUED',
    ])
  })

  it('should still run renders with the defaults', async () => {
    await expect(limiter.run(async () => 'png')).resolves.toBe('png')
  })
})
