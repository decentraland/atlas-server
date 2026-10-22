import { STOP_COMPONENT } from '@well-known-components/interfaces'
import { AppComponents } from '../../types'
import { RenderBusyError } from './errors'
import { IRenderLimiterComponent, RenderLimiterOptions } from './types'

type Waiter = {
  resolve: () => void
  reject: (error: Error) => void
  deadline: number
  timeout: NodeJS.Timeout
}

const DEFAULT_OPTIONS: RenderLimiterOptions = {
  maxConcurrent: 1,
  maxQueued: 8,
  maxWaitMs: 5000,
}

/**
 * Bounds how many PNG renders run at once. Drawing and encoding are synchronous and
 * every render holds a full canvas plus its PNG in memory, so excess work waits in a
 * short queue and is rejected when the queue is full or the wait is too long. Each
 * queued render starts on a later event loop turn, so I/O and timers run in between.
 * @param options - concurrency, queue size and maximum wait.
 * @returns the limiter component.
 */
export function createRenderLimiter(
  options: RenderLimiterOptions
): IRenderLimiterComponent {
  const { maxConcurrent, maxQueued, maxWaitMs } = options
  const queue: Waiter[] = []
  let active = 0

  function timeoutError(): RenderBusyError {
    return new RenderBusyError(
      `Timed out after ${maxWaitMs}ms waiting for a map render slot`
    )
  }

  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active++
      return Promise.resolve()
    }
    if (queue.length >= maxQueued) {
      return Promise.reject(new RenderBusyError('Too many map renders queued'))
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        deadline: Date.now() + maxWaitMs,
        timeout: setTimeout(() => {
          queue.splice(queue.indexOf(waiter), 1)
          reject(timeoutError())
        }, maxWaitMs),
      }
      queue.push(waiter)
    })
  }

  // hands the slot to the next live waiter, or frees it
  function grantNext(): void {
    const next = queue.shift()
    if (!next) {
      active--
      return
    }
    clearTimeout(next.timeout)
    if (Date.now() >= next.deadline) {
      next.reject(timeoutError())
      grantNext()
      return
    }
    next.resolve()
  }

  function release(): void {
    // yield a macrotask so synchronous renders never run back to back
    setImmediate(grantNext)
  }

  async function run<T>(task: () => Promise<T>): Promise<T> {
    await acquire()
    try {
      return await task()
    } finally {
      release()
    }
  }

  async function stop(): Promise<void> {
    for (const waiter of queue.splice(0)) {
      clearTimeout(waiter.timeout)
      waiter.reject(new RenderBusyError('Server is stopping'))
    }
  }

  return { run, [STOP_COMPONENT]: stop }
}

/**
 * Builds the limiter from config, falling back to the defaults for missing or invalid values.
 * @param components - config and logs.
 * @returns the limiter component.
 */
export async function createRenderLimiterComponent(
  components: Pick<AppComponents, 'config' | 'logs'>
): Promise<IRenderLimiterComponent> {
  const { config, logs } = components
  const logger = logs.getLogger('render-limiter')

  async function readPositiveInteger(
    name: string,
    defaultValue: number
  ): Promise<number> {
    const value = await config.getString(name)
    if (value === undefined || value === '') {
      return defaultValue
    }
    if (!/^[1-9]\d*$/.test(value)) {
      logger.warn('Invalid render limiter config, using the default', {
        name,
        value,
        defaultValue,
      })
      return defaultValue
    }
    return Number(value)
  }

  return createRenderLimiter({
    maxConcurrent: await readPositiveInteger(
      'RENDER_MAX_CONCURRENCY',
      DEFAULT_OPTIONS.maxConcurrent
    ),
    maxQueued: await readPositiveInteger(
      'RENDER_MAX_QUEUED',
      DEFAULT_OPTIONS.maxQueued
    ),
    maxWaitMs: await readPositiveInteger(
      'RENDER_MAX_WAIT_MS',
      DEFAULT_OPTIONS.maxWaitMs
    ),
  })
}
