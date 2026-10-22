import { IBaseComponent } from '@well-known-components/interfaces'
import { PngConfig } from 'canvas'
import { MapScene } from '../../modules/render'

/** Draws a map scene and encodes it with the default PNG settings. */
export type MapRenderJob = {
  kind: 'map'
  scene: MapScene
}

/** Encodes a raw RGBA picture, e.g. a minimap, as a PNG. */
export type PixelsRenderJob = {
  kind: 'pixels'
  width: number
  height: number
  /** width * height RGBA pixels; transferred to the worker, so unusable afterwards */
  data: Uint8ClampedArray
  compressionLevel: PngConfig['compressionLevel']
}

export type RenderJob = MapRenderJob | PixelsRenderJob

export type RenderResult = {
  png: Uint8Array
  /** time spent drawing and encoding */
  renderSeconds: number
}

export type RenderPoolOptions = {
  /** worker threads, i.e. renders running at the same time */
  maxThreads: number
  /** renders allowed to wait for a thread; more are rejected right away */
  maxQueued: number
  /** how long a render waits for a thread before it is rejected */
  maxWaitMs: number
  /** a compiled worker script to run instead of the one next to the component */
  workerFilename?: string
}

export type RenderOptions = {
  /** aborts the render while it waits for a thread, e.g. when the client disconnects */
  signal?: AbortSignal
}

export interface IRenderPoolComponent extends IBaseComponent {
  /**
   * Draws and encodes a PNG on a worker thread once one is free.
   * @param getJob - builds the render once a thread is free; its buffers are transferred to the worker.
   * @param options - an optional signal that cancels the wait for a thread.
   * @returns the encoded PNG.
   * @throws RenderBusyError when the queue is full, no thread frees up within maxWaitMs or the pool is not running.
   * @throws RenderAbortedError when the signal aborts before the render starts.
   */
  render(
    getJob: () => RenderJob | Promise<RenderJob>,
    options?: RenderOptions
  ): Promise<Buffer>
}
