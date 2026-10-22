import { spawn } from 'child_process'
import os from 'os'
import { performance } from 'perf_hooks'
import { createCanvas } from 'canvas'
import future, { IFuture } from 'fp-future'
import { Piscina } from 'piscina'
import {
  IBaseComponent,
  IConfigComponent,
  IMetricsComponent,
  START_COMPONENT,
  STOP_COMPONENT,
} from '@well-known-components/interfaces'
import {
  createRenderPoolComponent,
  IRenderPoolComponent,
  MapRenderJob,
  PixelsRenderJob,
  RenderAbortedError,
  RenderBusyError,
  RenderJob,
} from '../../src/adapters/render-pool'
import renderOnWorker from '../../src/adapters/render-pool/worker'
import { Metrics } from '../../src/metrics'
import {
  Coord,
  describeMap,
  getViewport,
  Layer,
  renderMap,
  RenderMapArgs,
} from '../../src/modules/render'
import { decodePng } from '../helpers/png'
import { startRenderPool, StartedRenderPool } from '../helpers/render-pool'

// transpiled by the jest globalSetup
const {
  COMPILED_RENDER_POOL,
  COMPILED_RENDER_WORKER,
} = require('../harness/compile-render-worker')

function buildMapArgs(
  width: number,
  height: number,
  size: number
): Omit<RenderMapArgs, 'ctx'> {
  const center: Coord = { x: 0, y: 0 }
  const { nw, se } = getViewport({ width, height, center, size, padding: 1 })
  const layers: Layer[] = [
    (x, y) => ({
      color: (x + y) % 2 === 0 ? '#3D3A46' : '#716C7A',
      top: y % 2 === 0,
      left: x % 3 === 0,
      topLeft: (x + y) % 4 === 0,
    }),
    (x, y) => (x === 1 && y === 1 ? { color: '#ff0044', scale: 1.4 } : null),
  ]
  return { width, height, size, pan: { x: 0, y: 0 }, center, nw, se, layers }
}

function buildMapJob(width: number, height: number, size: number) {
  const job: MapRenderJob = {
    kind: 'map',
    scene: describeMap(buildMapArgs(width, height, size)),
  }
  return job
}

function buildPixelsJob(pixels: number[][]): PixelsRenderJob {
  return {
    kind: 'pixels',
    width: pixels.length,
    height: 1,
    data: new Uint8ClampedArray(pixels.flat()),
    compressionLevel: 5,
  }
}

describe('when rendering in the render pool', () => {
  let renderPool: StartedRenderPool

  beforeEach(async () => {
    renderPool = await startRenderPool({
      maxThreads: 1,
      maxQueued: 1,
      maxWaitMs: 5000,
    })
  })

  afterEach(async () => {
    await renderPool.stop()
  })

  describe('and the job is a map scene', () => {
    let job: MapRenderJob
    let expected: Buffer
    let png: Buffer

    beforeEach(async () => {
      const canvas = createCanvas(120, 80)
      renderMap({ ...buildMapArgs(120, 80, 10), ctx: canvas.getContext('2d') })
      expected = canvas.toBuffer('image/png')
      job = buildMapJob(120, 80, 10)
      png = await renderPool.pool.render('map', () => job)
    })

    it('should encode the same PNG as drawing the layers on the main thread', () => {
      expect(png.equals(expected)).toBe(true)
    })

    it('should transfer the scene buffers to the worker instead of copying them', () => {
      expect(job.scene.layers[0].styles.byteLength).toBe(0)
    })

    it('should record the time spent drawing and encoding as a map render', () => {
      expect(renderPool.observe).toHaveBeenCalledWith(
        'dcl_map_render_time',
        { status: 200 },
        expect.any(Number)
      )
    })

    it('should record the time spent building the job on the main thread', () => {
      expect(renderPool.observe).toHaveBeenCalledWith(
        'dcl_map_render_prepare_seconds',
        { kind: 'map' },
        expect.any(Number)
      )
    })

    it('should record the wait for a thread as acquired', () => {
      expect(renderPool.endWaitTimer).toHaveBeenCalledWith({
        result: 'acquired',
      })
    })
  })

  describe('and the job is a raw picture', () => {
    let job: PixelsRenderJob
    let pixelAt: (x: number, y: number) => number[]

    beforeEach(async () => {
      job = buildPixelsJob([
        [1, 2, 3, 255],
        [0, 0, 0, 0],
        [255, 128, 7, 255],
      ])
      pixelAt = await decodePng(
        await renderPool.pool.render('minimap', () => job)
      )
    })

    it('should encode every pixel exactly', () => {
      expect([pixelAt(0, 0), pixelAt(1, 0), pixelAt(2, 0)]).toEqual([
        [1, 2, 3, 255],
        [0, 0, 0, 0],
        [255, 128, 7, 255],
      ])
    })

    it('should record the time spent encoding as a minimap render', () => {
      expect(renderPool.observe).toHaveBeenCalledWith(
        'dcl_mini_map_render_time',
        { status: 200 },
        expect.any(Number)
      )
    })
  })

  describe('and the worker fails to render the job', () => {
    let failedRender: Promise<Buffer>
    let nextRender: Promise<Buffer>

    beforeEach(async () => {
      // fewer bytes than width * height pixels
      failedRender = renderPool.pool.render('minimap', () => ({
        ...buildPixelsJob([[0, 0, 0, 255]]),
        width: 2,
      }))
      await failedRender.catch(() => undefined)
      nextRender = renderPool.pool.render('minimap', () =>
        buildPixelsJob([[0, 0, 0, 255]])
      )
    })

    it('should reject with the error of the worker', async () => {
      await expect(failedRender).rejects.toThrow(
        'Expected 8 bytes of RGBA pixels, got 4'
      )
    })

    it('should record the render with a 500 status', () => {
      expect(renderPool.observe).toHaveBeenCalledWith(
        'dcl_mini_map_render_time',
        { status: 500 },
        expect.any(Number)
      )
    })

    it('should keep rendering the next jobs', async () => {
      await expect(nextRender).resolves.toBeInstanceOf(Buffer)
    })
  })

  describe('and the job cannot be sent to the worker', () => {
    let failedRender: Promise<Buffer>
    let nextRender: Promise<Buffer>

    beforeEach(async () => {
      failedRender = renderPool.pool.render(
        'minimap',
        () =>
          ({
            ...buildPixelsJob([[0, 0, 0, 255]]),
            notCloneable: () => undefined,
          } as RenderJob)
      )
      await failedRender.catch(() => undefined)
      nextRender = renderPool.pool.render('minimap', () =>
        buildPixelsJob([[0, 0, 0, 255]])
      )
      await nextRender
    })

    it('should reject with the transport error', async () => {
      await expect(failedRender).rejects.toThrow('could not be cloned')
    })

    it('should log the failure', () => {
      expect(renderPool.logError).toHaveBeenCalledWith(
        'The render pool failed to run a render',
        {
          kind: 'minimap',
          error: expect.stringContaining('could not be cloned'),
        }
      )
    })

    it('should not record it as a render time', () => {
      expect(renderPool.observe).not.toHaveBeenCalledWith(
        'dcl_mini_map_render_time',
        { status: 500 },
        expect.any(Number)
      )
    })
  })

  describe('and the request is aborted while its job is built', () => {
    let failedRender: Promise<Buffer>
    let nextRender: Promise<Buffer>

    beforeEach(async () => {
      const controller = new AbortController()
      failedRender = renderPool.pool.render(
        'minimap',
        () => {
          controller.abort()
          return buildPixelsJob([[0, 0, 0, 255]])
        },
        { signal: controller.signal }
      )
      await failedRender.catch(() => undefined)
      nextRender = renderPool.pool.render('minimap', () =>
        buildPixelsJob([[0, 0, 0, 255]])
      )
      await nextRender.catch(() => undefined)
    })

    it('should reject with an aborted error', async () => {
      await expect(failedRender).rejects.toThrow(RenderAbortedError)
    })

    it('should not send the job to a worker', () => {
      // only the next render reaches one
      expect(
        renderPool.observe.mock.calls.filter(
          ([name]) => name === 'dcl_mini_map_render_time'
        )
      ).toHaveLength(1)
    })

    it('should free the thread for the next render', async () => {
      await expect(nextRender).resolves.toBeInstanceOf(Buffer)
    })
  })

  describe('and the pool is stopped right after a render is admitted', () => {
    let render: Promise<Buffer>

    beforeEach(async () => {
      render = renderPool.pool.render('minimap', () =>
        buildPixelsJob([[0, 0, 0, 255]])
      )
      await renderPool.stop()
    })

    it('should let the render finish', async () => {
      await expect(render).resolves.toBeInstanceOf(Buffer)
    })
  })

  describe('and building the job fails', () => {
    let failedRender: Promise<Buffer>
    let nextRender: Promise<Buffer>

    beforeEach(async () => {
      failedRender = renderPool.pool.render('minimap', () =>
        Promise.reject(new Error('No tiles'))
      )
      await failedRender.catch(() => undefined)
      nextRender = renderPool.pool.render('minimap', () =>
        buildPixelsJob([[0, 0, 0, 255]])
      )
    })

    it('should reject with the error', async () => {
      await expect(failedRender).rejects.toThrow('No tiles')
    })

    it('should free the thread for the next render', async () => {
      await expect(nextRender).resolves.toBeInstanceOf(Buffer)
    })
  })

  describe('and every thread is busy', () => {
    let runningJob: IFuture<RenderJob>
    let runningRender: Promise<Buffer>
    let queuedGetJob: jest.Mock
    let queuedRender: Promise<Buffer>
    let controller: AbortController

    beforeEach(() => {
      // the running render holds the only thread until its job is built
      runningJob = future<RenderJob>()
      runningRender = renderPool.pool.render('minimap', () => runningJob)
      queuedGetJob = jest.fn(() => buildPixelsJob([[0, 0, 0, 255]]))
      controller = new AbortController()
      queuedRender = renderPool.pool.render('minimap', queuedGetJob, {
        signal: controller.signal,
      })
    })

    afterEach(async () => {
      runningJob.resolve(buildPixelsJob([[0, 0, 0, 255]]))
      await Promise.allSettled([runningRender, queuedRender])
    })

    it('should not start the queued render', () => {
      expect(queuedGetJob).not.toHaveBeenCalled()
    })

    describe('and the running render finishes', () => {
      beforeEach(async () => {
        runningJob.resolve(buildPixelsJob([[0, 0, 0, 255]]))
        await runningRender
      })

      it('should run the queued render', async () => {
        await expect(queuedRender).resolves.toBeInstanceOf(Buffer)
      })
    })

    describe('and the queue is full', () => {
      let rejectedRender: Promise<Buffer>

      beforeEach(async () => {
        rejectedRender = renderPool.pool.render('minimap', queuedGetJob)
        await rejectedRender.catch(() => undefined)
      })

      it('should reject the new render right away with a busy error', async () => {
        await expect(rejectedRender).rejects.toThrow(
          new RenderBusyError('Too many map renders queued')
        )
      })

      it('should record the wait for a thread as rejected', () => {
        expect(renderPool.endWaitTimer).toHaveBeenCalledWith({
          result: 'rejected',
        })
      })
    })

    describe('and the request is aborted while the render waits', () => {
      beforeEach(async () => {
        controller.abort()
        await queuedRender.catch(() => undefined)
      })

      it('should reject the queued render with an aborted error', async () => {
        await expect(queuedRender).rejects.toThrow(RenderAbortedError)
      })

      it('should not build the job of the queued render', () => {
        expect(queuedGetJob).not.toHaveBeenCalled()
      })

      describe('and the running render finishes', () => {
        let nextRender: Promise<Buffer>

        beforeEach(async () => {
          nextRender = renderPool.pool.render('minimap', () =>
            buildPixelsJob([[0, 0, 0, 255]])
          )
          runningJob.resolve(buildPixelsJob([[0, 0, 0, 255]]))
          await runningRender
        })

        it('should have freed the queue for the next render', async () => {
          await expect(nextRender).resolves.toBeInstanceOf(Buffer)
        })
      })
    })

    describe('and the pool is stopped', () => {
      beforeEach(async () => {
        const stopping = renderPool.stop()
        await queuedRender.catch(() => undefined)
        runningJob.resolve(buildPixelsJob([[0, 0, 0, 255]]))
        await stopping
      })

      it('should reject the queued render with a busy error', async () => {
        await expect(queuedRender).rejects.toThrow(
          new RenderBusyError('Server is stopping')
        )
      })

      it('should let the running render finish before closing the threads', async () => {
        await expect(runningRender).resolves.toBeInstanceOf(Buffer)
      })
    })
  })

  describe('and the request was already aborted', () => {
    let getJob: jest.Mock
    let render: Promise<Buffer>

    beforeEach(async () => {
      getJob = jest.fn()
      const controller = new AbortController()
      controller.abort()
      render = renderPool.pool.render('minimap', getJob, {
        signal: controller.signal,
      })
      await render.catch(() => undefined)
    })

    it('should reject with an aborted error without building the job', async () => {
      await expect(render).rejects.toThrow(RenderAbortedError)
    })
  })
})

describe('when no thread frees up within the maximum wait', () => {
  let renderPool: StartedRenderPool
  let runningJob: IFuture<RenderJob>
  let runningRender: Promise<Buffer>
  let queuedGetJob: jest.Mock
  let queuedRender: Promise<Buffer>

  beforeEach(async () => {
    renderPool = await startRenderPool({
      maxThreads: 1,
      maxQueued: 1,
      maxWaitMs: 50,
    })
    runningJob = future<RenderJob>()
    runningRender = renderPool.pool.render('minimap', () => runningJob)
    queuedGetJob = jest.fn()
    queuedRender = renderPool.pool.render('minimap', queuedGetJob)
    await queuedRender.catch(() => undefined)
  })

  afterEach(async () => {
    runningJob.resolve(buildPixelsJob([[0, 0, 0, 255]]))
    await runningRender.catch(() => undefined)
    await renderPool.stop()
  })

  it('should reject the queued render with a timeout error', async () => {
    await expect(queuedRender).rejects.toThrow(
      new RenderBusyError('Timed out after 50ms waiting for a map render slot')
    )
  })

  it('should not build the job of the queued render', () => {
    expect(queuedGetJob).not.toHaveBeenCalled()
  })
})

describe('when the render pool is stopped', () => {
  let renderPool: StartedRenderPool
  let close: jest.SpyInstance
  let render: Promise<Buffer>

  beforeEach(async () => {
    close = jest.spyOn(Piscina.prototype, 'close')
    renderPool = await startRenderPool()
    await renderPool.pool.render('minimap', () =>
      buildPixelsJob([[0, 0, 0, 255]])
    )
    await renderPool.stop()
    render = renderPool.pool.render('minimap', () =>
      buildPixelsJob([[0, 0, 0, 255]])
    )
    await render.catch(() => undefined)
  })

  afterEach(() => {
    close.mockRestore()
  })

  it('should close its worker threads', () => {
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('should reject new renders with a busy error', async () => {
    await expect(render).rejects.toThrow(
      new RenderBusyError('Map renders are not running')
    )
  })
})

describe('when the render pool is stopped shortly after it starts', () => {
  let exit: { code: number | null; signal: NodeJS.Signals | null }

  beforeEach(async () => {
    // a fresh process that has not loaded canvas, like the service: terminating a thread
    // while it loads canvas there aborts the whole process
    const script = `
      const { createRenderPool } = require(${JSON.stringify(
        COMPILED_RENDER_POOL
      )})
      const { START_COMPONENT, STOP_COMPONENT } = require('@well-known-components/interfaces')
      const noop = () => undefined
      const logs = { getLogger: () => ({ error: noop, warn: noop, info: noop, debug: noop, log: noop }) }
      const metrics = { startTimer: () => ({ end: noop }), observe: noop }
      ;(async () => {
        for (let delayMs = 0; delayMs <= 40; delayMs += 2) {
          const pool = createRenderPool({ metrics, logs }, { maxThreads: 1, maxQueued: 1, maxWaitMs: 1000 })
          await pool[START_COMPONENT]()
          await new Promise((resolve) => setTimeout(resolve, delayMs))
          await pool[STOP_COMPONENT]()
        }
      })()
    `
    exit = await new Promise((resolve) =>
      spawn(process.execPath, ['-e', script], {
        cwd: process.cwd(),
        stdio: 'ignore',
      }).on('exit', (code, signal) => resolve({ code, signal }))
    )
  })

  it('should close the threads cleanly every time', () => {
    expect(exit).toEqual({ code: 0, signal: null })
  })
})

describe('when the render pool starts', () => {
  let renderPool: StartedRenderPool
  let firstRenderMs: number

  beforeEach(async () => {
    renderPool = await startRenderPool()
    const startedAt = performance.now()
    await renderPool.pool.render('minimap', () =>
      buildPixelsJob([[0, 0, 0, 255]])
    )
    firstRenderMs = performance.now() - startedAt
  })

  afterEach(async () => {
    await renderPool.stop()
  })

  it('should have a thread with canvas loaded before the first render', () => {
    // loading canvas in a new thread takes ~100 ms; a warm thread answers in a few
    expect(firstRenderMs).toBeLessThan(50)
  })
})

describe('when a large map renders in the render pool', () => {
  let renderPool: StartedRenderPool
  let blockedShares: number[]

  // the longest the timers stopped firing, as a share of the render's duration
  async function measureBlockedShare(job: MapRenderJob): Promise<number> {
    let longestTimerGap = 0
    let lastTick = performance.now()
    const tick = () => {
      const now = performance.now()
      longestTimerGap = Math.max(longestTimerGap, now - lastTick)
      lastTick = now
    }
    const interval = setInterval(tick, 1)
    const startedAt = performance.now()
    try {
      await renderPool.pool.render('map', () => job)
    } finally {
      clearInterval(interval)
    }
    // also counts a block that lasted until the render resolved
    tick()
    return longestTimerGap / (performance.now() - startedAt)
  }

  beforeEach(async () => {
    renderPool = await startRenderPool({ maxThreads: 1 })
    // the first render waits for the worker to boot
    await renderPool.pool.render('map', () => buildMapJob(100, 100, 10))
    const jobs = [1, 2, 3].map(() => buildMapJob(1024, 1024, 5))
    blockedShares = []
    for (const job of jobs) {
      blockedShares.push(await measureBlockedShare(job))
    }
  })

  afterEach(async () => {
    await renderPool.stop()
  })

  // the best of three, so a busy machine pausing the test does not fail it
  it('should keep running the timers while the image is drawn and encoded', () => {
    expect(Math.min(...blockedShares)).toBeLessThan(0.5)
  })
})

describe('when the worker entry point renders a job', () => {
  let result: unknown

  beforeEach(() => {
    result = renderOnWorker(buildPixelsJob([[0, 0, 0, 255]]))
  })

  it('should mark the PNG buffer to be transferred back', () => {
    expect(result).toEqual(
      expect.objectContaining({
        [Piscina.transferableSymbol]: expect.any(ArrayBuffer),
        [Piscina.valueSymbol]: {
          png: expect.any(Uint8Array),
          renderSeconds: expect.any(Number),
        },
      })
    )
  })
})

describe('when creating the render pool from config', () => {
  let values: Record<string, string | undefined>
  let warn: jest.Mock
  let pool: IRenderPoolComponent

  // without a worker override: worker.ts runs through ts-node, as in development
  function createFromConfig(
    overrides: Parameters<typeof createRenderPoolComponent>[1] = {}
  ) {
    return createRenderPoolComponent(
      {
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
        metrics: {
          startTimer: jest.fn(() => ({ end: jest.fn() })),
          observe: jest.fn(),
        } as unknown as IMetricsComponent<keyof Metrics>,
      },
      overrides
    )
  }

  beforeEach(() => {
    warn = jest.fn()
  })

  afterEach(async () => {
    await pool[STOP_COMPONENT]!()
  })

  describe('and the values are not positive integers', () => {
    beforeEach(async () => {
      values = { RENDER_MAX_CONCURRENCY: '0', RENDER_MAX_QUEUED: 'abc' }
      pool = await createFromConfig()
      await pool[START_COMPONENT]!({} as IBaseComponent.ComponentStartOptions)
    })

    it('should warn about every invalid value', () => {
      expect(warn.mock.calls.map(([, context]) => context.name)).toEqual([
        'RENDER_MAX_CONCURRENCY',
        'RENDER_MAX_QUEUED',
      ])
    })

    it('should still render with the defaults', async () => {
      await expect(
        pool.render('minimap', () => buildPixelsJob([[0, 0, 0, 255]]))
      ).resolves.toBeInstanceOf(Buffer)
    })
  })

  describe.each([
    [1, 1],
    [8, 2],
  ])('and the concurrency is not set on %i CPUs', (cpus, threads) => {
    let jobs: IFuture<RenderJob>
    let getJob: jest.Mock
    let renders: Promise<Buffer>[]

    beforeEach(async () => {
      values = {}
      jest.spyOn(os, 'availableParallelism').mockReturnValue(cpus)
      pool = await createFromConfig({ workerFilename: COMPILED_RENDER_WORKER })
      await pool[START_COMPONENT]!({} as IBaseComponent.ComponentStartOptions)
      jobs = future<RenderJob>()
      getJob = jest.fn(() => jobs)
      renders = [1, 2, 3, 4].map(() => pool.render('minimap', getJob))
      await new Promise((resolve) => setImmediate(resolve))
    })

    afterEach(async () => {
      // nothing reaches a thread
      jobs.reject(new Error('Not needed'))
      await Promise.allSettled(renders)
      jest.restoreAllMocks()
    })

    it(`should run ${threads} render(s) at the same time`, () => {
      expect(getJob).toHaveBeenCalledTimes(threads)
    })
  })
})
