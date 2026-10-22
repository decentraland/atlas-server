import { IBaseComponent } from '@well-known-components/interfaces'

export type RenderLimiterOptions = {
  /** renders (draw + PNG encode) allowed to run at the same time */
  maxConcurrent: number
  /** renders allowed to wait for a slot; more are rejected right away */
  maxQueued: number
  /** how long a queued render waits for a slot before it is rejected */
  maxWaitMs: number
}

export interface IRenderLimiterComponent extends IBaseComponent {
  /**
   * Runs a render once a slot is free.
   * @param task - the work to bound; it must finish the PNG encode before resolving.
   * @returns the task's result.
   * @throws RenderQueueFullError when the queue is full.
   * @throws RenderQueueTimeoutError when no slot frees up within maxWaitMs.
   */
  run<T>(task: () => Promise<T>): Promise<T>
}
