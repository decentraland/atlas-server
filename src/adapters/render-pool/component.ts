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
import {
  RenderAbortedError,
  RenderBusyError,
  RenderFailedError,
} from './errors'
import {
  IRenderPoolComponent,
  RenderJob,
  RenderKind,
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
// one thread stays up so canvas is loaded before the first render; the others exit after this long idle
const IDLE_TIMEOUT_MS = 60_000
// the V8 heap of a thread; the canvas pixels are native memory and not counted here
const WORKER_MAX_OLD_GENERATION_MB = 256
// each thread holds up to a 2048x2048 canvas and its PNG, so more CPUs don't mean more threads
const DEFAULT_MAX_THREADS = 2

const DEFAULT_MAX_QUEUED = 8
const DEFAULT_MAX_WAIT_MS = 5000

/** Why a render failed, for dcl_map_render_errors_total. */
type RenderErrorReason =
  /** no thread within the queue and wait bounds, or the pool is not running */
  | 'busy'
  /** the client left before the job reached a thread */
  | 'aborted'
  /** building the job on the main thread failed */
  | 'prepare'
  /** the job could not be sent to a thread */
  | 'transport'
  /** the worker reported an error drawing or encoding */
  | 'worker_error'
  /** the thread died mid-render, e.g. out of memory */
  | 'worker_crash'

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
 * @param components - metrics, for the prepare, wait and render time histograms, and logs.
 * @param options - threads, queue size and maximum wait.
 * @returns the pool component; it accepts renders once started.
 */
export function createRenderPool(
  components: Pick<AppComponents, 'metrics' | 'logs'>,
  options: RenderPoolOptions
): IRenderPoolComponent {
  const { metrics, logs } = components
  const logger = logs.getLogger('render-pool')
  const { maxThreads, maxQueued, maxWaitMs, workerFilename } = options
  const queue: Waiter[] = []
  const rendering = new Set<Promise<Buffer>>()
  let active = 0
  let accepting = false
  let pool: Piscina<RenderJob, RenderResult> | undefined

  function countError(kind: RenderKind, reason: RenderErrorReason): void {
    metrics.increment('dcl_map_render_errors_total', { kind, reason })
  }

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

  async function run(kind: RenderKind, job: RenderJob): Promise<Buffer> {
    if (!pool) {
      countError(kind, 'busy')
      throw new RenderBusyError('Map renders are not running')
    }
    let result: RenderResult
    try {
      result = await pool.run(job, { transferList: getTransferList(job) })
    } catch (error) {
      // the worker never reported back: the job was not sent, or its thread died
      // (e.g. out of memory), so there is no render time, only the error count
      // a DataCloneError is a DOMException, which is not an Error
      const { name, message } = Object(error)
      const reason = name === 'DataCloneError' ? 'transport' : 'worker_crash'
      countError(kind, reason)
      logger.error('The render pool failed to run a render', {
        kind,
        reason,
        error: typeof message === 'string' ? message : String(error),
      })
      throw error
    }
    // both from the worker's clock: the time it spent drawing and encoding
    const metric =
      kind === 'map' ? 'dcl_map_render_time' : 'dcl_mini_map_render_time'
    if (!('png' in result)) {
      countError(kind, 'worker_error')
      metrics.observe(metric, { status: 500 }, result.renderSeconds)
      throw new RenderFailedError(result.error.message)
    }
    metrics.observe(metric, { status: 200 }, result.renderSeconds)
    const { png } = result
    return Buffer.from(png.buffer, png.byteOffset, png.byteLength)
  }

  async function prepareAndRun(
    kind: RenderKind,
    getJob: () => RenderJob | Promise<RenderJob>,
    signal: AbortSignal | undefined
  ): Promise<Buffer> {
    const waitTimer = metrics.startTimer('dcl_map_render_wait_seconds')
    try {
      await acquire(signal)
    } catch (error) {
      waitTimer.end({ result: 'rejected' })
      countError(kind, error instanceof RenderAbortedError ? 'aborted' : 'busy')
      throw error
    }
    waitTimer.end({ result: 'acquired' })
    try {
      const preparedAt = performance.now()
      let job: RenderJob
      try {
        job = await getJob()
      } catch (error) {
        countError(kind, 'prepare')
        throw error
      }
      metrics.observe(
        'dcl_map_render_prepare_seconds',
        { kind },
        (performance.now() - preparedAt) / 1000
      )
      // the client left while the job was being built
      if (signal?.aborted) {
        countError(kind, 'aborted')
        throw new RenderAbortedError('The request was aborted')
      }
      return await run(kind, job)
    } finally {
      release()
    }
  }

  function render(
    kind: RenderKind,
    getJob: () => RenderJob | Promise<RenderJob>,
    options: RenderOptions = {}
  ): Promise<Buffer> {
    // tracked before anything awaits, so a stop() right after admission still waits for it
    const png = prepareAndRun(kind, getJob, options.signal)
    rendering.add(png)
    png.then(
      () => rendering.delete(png),
      () => rendering.delete(png)
    )
    return png
  }

  async function start(): Promise<void> {
    accepting = true
    if (pool) {
      return
    }
    pool = new Piscina<RenderJob, RenderResult>({
      filename: workerFilename ?? WORKER_FILENAME,
      execArgv: workerFilename ? undefined : WORKER_EXEC_ARGV,
      minThreads: 1,
      maxThreads,
      idleTimeout: IDLE_TIMEOUT_MS,
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_GENERATION_MB },
    })
    // a thread failing outside a render (e.g. on boot) is emitted here, and would throw unheard
    pool.on('error', (error: unknown) =>
      logger.error('A render thread failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    )
    // loads canvas now, so the first render doesn't pay for it and stop() never
    // terminates a thread halfway through loading it, which aborts the process
    try {
      await pool.run({
        kind: 'pixels',
        width: 1,
        height: 1,
        data: new Uint8ClampedArray(4),
        compressionLevel: 5,
      })
    } catch (error) {
      accepting = false
      const failed = pool
      pool = undefined
      await failed.destroy()
      throw error
    }
  }

  async function stop(): Promise<void> {
    accepting = false
    for (const waiter of queue.splice(0)) {
      waiter.dispose()
      waiter.reject(new RenderBusyError('Server is stopping'))
    }
    // lets the admitted renders finish, then terminates the threads
    await Promise.allSettled(rendering)
    const stopping = pool
    pool = undefined
    await stopping?.close()
  }

  return { render, [START_COMPONENT]: start, [STOP_COMPONENT]: stop }
}

/**
 * Builds the render pool from config, falling back to the defaults for missing or
 * invalid values: one thread per CPU up to 2, 8 queued renders and a 5s wait.
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
    { metrics, logs },
    {
      maxThreads: await readPositiveInteger(
        'RENDER_MAX_CONCURRENCY',
        Math.min(availableParallelism(), DEFAULT_MAX_THREADS)
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
