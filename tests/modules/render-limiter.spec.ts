import { STOP_COMPONENT } from '@well-known-components/interfaces'
import future, { IFuture } from 'fp-future'
import {
  createRenderLimiter,
  IRenderLimiterComponent,
  RenderBusyError,
  RenderQueueFullError,
  RenderQueueTimeoutError,
} from '../../src/modules/render-limiter'

describe('when running renders through the render limiter', () => {
  let limiter: IRenderLimiterComponent
  let firstRender: IFuture<string>
  let firstRun: Promise<string>
  let secondTask: jest.Mock

  beforeEach(() => {
    jest.useFakeTimers()
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
        await expect(secondRun).rejects.toThrow(RenderQueueTimeoutError)
      })
    })

    describe('and the queue is full', () => {
      let thirdRun: Promise<string>

      beforeEach(() => {
        thirdRun = limiter.run(secondTask)
      })

      it('should reject the new task right away with a queue full error', async () => {
        await expect(thirdRun).rejects.toThrow(RenderQueueFullError)
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
