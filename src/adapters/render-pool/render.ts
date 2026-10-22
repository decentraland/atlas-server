import { performance } from 'perf_hooks'
import { Canvas, createCanvas, ImageData } from 'canvas'
import { getSceneLayers, renderMap } from '../../modules/render'
import { RenderJob, RenderResult } from './types'

function encode(canvas: Canvas, toPng: () => Buffer): Buffer {
  try {
    return toPng()
  } finally {
    // frees the pixels now rather than on the worker's next GC, which keeps its RSS flat
    canvas.width = 0
  }
}

function draw(job: RenderJob): Buffer {
  switch (job.kind) {
    case 'map': {
      const { scene } = job
      const canvas = createCanvas(scene.width, scene.height)
      renderMap({
        ...scene,
        ctx: canvas.getContext('2d'),
        layers: getSceneLayers(scene),
      })
      return encode(canvas, () => canvas.toBuffer('image/png'))
    }
    case 'pixels': {
      const { width, height, data, compressionLevel } = job
      // node-canvas reads width * height pixels without checking the length
      if (data.length !== width * height * 4) {
        throw new RangeError(
          `Expected ${width * height * 4} bytes of RGBA pixels, got ${
            data.length
          }`
        )
      }
      const canvas = createCanvas(width, height)
      canvas
        .getContext('2d')
        .putImageData(new ImageData(data, width, height), 0, 0)
      return encode(canvas, () =>
        canvas.toBuffer('image/png', { compressionLevel })
      )
    }
  }
}

/**
 * Draws and encodes a render job. Runs on the worker threads.
 * @param job - the render.
 * @returns the PNG in a buffer of its own, so it can be transferred back, or the error, and the time it took.
 */
export function renderJob(job: RenderJob): RenderResult {
  const startedAt = performance.now()
  let buffer: Buffer
  try {
    buffer = draw(job)
  } catch (error) {
    // returned rather than thrown, so a failure is timed like a success
    return {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message }
          : { name: 'Error', message: String(error) },
      renderSeconds: (performance.now() - startedAt) / 1000,
    }
  }
  const renderSeconds = (performance.now() - startedAt) / 1000
  // a view over a shared allocation must be copied before its buffer is transferred
  const png =
    buffer.byteOffset === 0 && buffer.byteLength === buffer.buffer.byteLength
      ? new Uint8Array(buffer.buffer, 0, buffer.byteLength)
      : new Uint8Array(buffer)
  return { png, renderSeconds }
}
