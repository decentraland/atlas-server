import { availableParallelism } from 'os'
import { extname, join } from 'path'
import { performance } from 'perf_hooks'
import { Piscina } from 'piscina'
import {
  START_COMPONENT,
  STOP_COMPONENT,
} from '@well-known-components/interfaces'
import { getSceneTransferList } from '../../modules/render'
import { AppComponents } from '../../types'
import { RenderAbortedError, RenderBusyError } from './errors'
import {
  IRenderPoolComponent,
  RenderJob,
  RenderOptions,
  RenderPoolOptions,
  RenderResult,
} from './types'

// worker.js next to the compiled component, or worker.ts through ts-node when running the sources
const WORKER_EXTENSION = extname(__filename)
const WORKER_FILENAME = join(__dirname, `worker${WORKER_EXTENSION}`)
const WORKER_EXEC_ARGV =
  WORKER_EXTENSION === '.ts'
    ? ['--require', 'ts-node/register/transpile-only']
    : undefined
// threads start on the first render and exit after this long idle
const IDLE_TIMEOUT_MS = 60_000

const DEFAULT_MAX_QUEUED = 8
const DEFAULT_MAX_WAIT_MS = 5000

type Waiter = {
  resolve: () => void
  reject: (error: Error) => void
  deadline: number
  dispose: () => void
}

function getTransferList(job: RenderJob): ArrayBufferLike[] {
  return job.kind === 'map'
    ? getSceneTransferList(job.scene)
    : [job.data.buffer]
}

/**
 * Renders PNGs on a pool of worker threads, so drawing and encoding never block the
 * event loop. Every thread renders one image at a time; excess renders wait in a short
 * queue and are rejected when the queue is full or the wait is too long. The queue lives
 * here rather than in piscina so the wait can be timed and bounded.
 * @param components - metrics, for the wait and render time histograms.
 * @param options - threads, queue size and maximum wait.
 * @returns the pool component; it accepts renders once started.
 */
export function createRenderPool(
  components: Pick<AppComponents, 'metrics'>,
  options: RenderPoolOptions
): IRenderPoolComponent {
  const { metrics } = components
  const { maxThreads, maxQueued, maxWaitMs, workerFilename } = options
  const queue: Waiter[] = []
  const rendering = new Set<Promise<Buffer>>()
  let active = 0
  let accepting = false
  let pool: Piscina<RenderJob, RenderResult> | undefined

  function timeoutError(): RenderBusyError {
    return new RenderBusyError(
      `Timed out after ${maxWaitMs}ms waiting for a map render slot`
    )
  }

  function acquire(signal: AbortSignal | undefined): Promise<void> {
    if (!accepting) {
      return Promise.reject(new RenderBusyError('Map renders are not running'))
    }
    if (signal?.aborted) {
      return Promise.reject(new RenderAbortedError('The request was aborted'))
    }
    if (active < maxThreads) {
      active++
      return Promise.resolve()
    }
    if (queue.length >= maxQueued) {
      return Promise.reject(new RenderBusyError('Too many map renders queued'))
    }
    return new Promise((resolve, reject) => {
      function leave(error: Error) {
        queue.splice(queue.indexOf(waiter), 1)
        waiter.dispose()
        reject(error)
      }
      const onAbort = () =>
        leave(new RenderAbortedError('The request was aborted'))
      const timeout = setTimeout(() => leave(timeoutError()), maxWaitMs)
      const waiter: Waiter = {
        resolve,
        reject,
        deadline: Date.now() + maxWaitMs,
        dispose: () => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', onAbort)
        },
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      queue.push(waiter)
    })
  }

  // hands the thread to the next live waiter, or frees it
  function release(): void {
    const next = queue.shift()
    if (!next) {
      active--
      return
    }
    next.dispose()
    if (Date.now() >= next.deadline) {
      next.reject(timeoutError())
      release()
      return
    }
    next.resolve()
  }

  async function run(job: RenderJob): Promise<Buffer> {
    if (!pool) {
      throw new RenderBusyError('Map renders are not running')
    }
    const metric =
      job.kind === 'map' ? 'dcl_map_render_time' : 'dcl_mini_map_render_time'
    const startedAt = performance.now()
    try {
      const { png, renderSeconds } = await pool.run(job, {
        transferList: getTransferList(job),
      })
      metrics.observe(metric, { status: 200 }, renderSeconds)
      return Buffer.from(png.buffer, png.byteOffset, png.byteLength)
    } catch (error) {
      metrics.observe(
        metric,
        { status: 500 },
        (performance.now() - startedAt) / 1000
      )
      throw error
    }
  }

  async function render(
    getJob: () => RenderJob | Promise<RenderJob>,
    options: RenderOptions = {}
  ): Promise<Buffer> {
    const waitTimer = metrics.startTimer('dcl_map_render_wait_seconds')
    try {
      await acquire(options.signal)
    } catch (error) {
      waitTimer.end({ result: 'rejected' })
      throw error
    }
    waitTimer.end({ result: 'acquired' })
    const png = (async () => {
      try {
        return await run(await getJob())
      } finally {
        release()
      }
    })()
    rendering.add(png)
    try {
      return await png
    } finally {
      rendering.delete(png)
    }
  }

  async function start(): Promise<void> {
    accepting = true
    pool ??= new Piscina<RenderJob, RenderResult>({
      filename: workerFilename ?? WORKER_FILENAME,
      execArgv: workerFilename ? undefined : WORKER_EXEC_ARGV,
      minThreads: 0,
      maxThreads,
      idleTimeout: IDLE_TIMEOUT_MS,
    })
  }

  async function stop(): Promise<void> {
    accepting = false
    for (const waiter of queue.splice(0)) {
      waiter.dispose()
      waiter.reject(new RenderBusyError('Server is stopping'))
    }
    // lets the renders that got a thread finish, then terminates the threads
    await Promise.allSettled(rendering)
    const stopping = pool
    pool = undefined
    await stopping?.close()
  }

  return { render, [START_COMPONENT]: start, [STOP_COMPONENT]: stop }
}

/**
 * Builds the render pool from config, falling back to the defaults for missing or
 * invalid values: one thread per CPU, 8 queued renders and a 5s wait.
 * @param components - config, logs and metrics.
 * @param overrides - e.g. a precompiled worker script.
 * @returns the render pool component.
 */
export async function createRenderPoolComponent(
  components: Pick<AppComponents, 'config' | 'logs' | 'metrics'>,
  overrides: Pick<RenderPoolOptions, 'workerFilename'> = {}
): Promise<IRenderPoolComponent> {
  const { config, logs, metrics } = components
  const logger = logs.getLogger('render-pool')

  async function readPositiveInteger(
    name: string,
    defaultValue: number
  ): Promise<number> {
    const value = await config.getString(name)
    if (value === undefined || value === '') {
      return defaultValue
    }
    if (!/^[1-9]\d*$/.test(value)) {
      logger.warn('Invalid render pool config, using the default', {
        name,
        value,
        defaultValue,
      })
      return defaultValue
    }
    return Number(value)
  }

  return createRenderPool(
    { metrics },
    {
      maxThreads: await readPositiveInteger(
        'RENDER_MAX_CONCURRENCY',
        availableParallelism()
      ),
      maxQueued: await readPositiveInteger(
        'RENDER_MAX_QUEUED',
        DEFAULT_MAX_QUEUED
      ),
      maxWaitMs: await readPositiveInteger(
        'RENDER_MAX_WAIT_MS',
        DEFAULT_MAX_WAIT_MS
      ),
      ...overrides,
    }
  )
}
