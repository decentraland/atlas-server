import { STOP_COMPONENT } from '@well-known-components/interfaces'
import { AppComponents } from '../../types'
import {
  RenderBusyError,
  RenderQueueFullError,
  RenderQueueTimeoutError,
} from './errors'
import { IRenderLimiterComponent, RenderLimiterOptions } from './types'

type Waiter = {
  resolve: () => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

/**
 * Bounds how many PNG renders run at once. Drawing blocks the event loop and every
 * render holds a full canvas plus its PNG in memory, so excess work waits in a short
 * queue and is rejected when the queue is full or the wait is too long.
 * @param options - concurrency, queue size and maximum wait.
 * @returns the limiter component.
 */
export function createRenderLimiter(
  options: RenderLimiterOptions
): IRenderLimiterComponent {
  const { maxConcurrent, maxQueued, maxWaitMs } = options
  const queue: Waiter[] = []
  let active = 0

  function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active++
      return Promise.resolve()
    }
    if (queue.length >= maxQueued) {
      return Promise.reject(new RenderQueueFullError())
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        timeout: setTimeout(() => {
          queue.splice(queue.indexOf(waiter), 1)
          reject(new RenderQueueTimeoutError(maxWaitMs))
        }, maxWaitMs),
      }
      queue.push(waiter)
    })
  }

  function release(): void {
    const next = queue.shift()
    if (next) {
      // the slot passes straight to the next waiter
      clearTimeout(next.timeout)
      next.resolve()
    } else {
      active--
    }
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
 * Builds the limiter from config.
 * @param components - config.
 * @returns the limiter component.
 */
export async function createRenderLimiterComponent(
  components: Pick<AppComponents, 'config'>
): Promise<IRenderLimiterComponent> {
  const { config } = components
  return createRenderLimiter({
    maxConcurrent: (await config.getNumber('RENDER_MAX_CONCURRENCY')) ?? 2,
    maxQueued: (await config.getNumber('RENDER_MAX_QUEUED')) ?? 8,
    maxWaitMs: (await config.getNumber('RENDER_MAX_WAIT_MS')) ?? 5000,
  })
}
