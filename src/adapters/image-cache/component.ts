import { LRUCache } from 'lru-cache'
import { RenderAbortedError } from '../render-pool'
import { AppComponents } from '../../types'
import {
  IImageCacheComponent,
  ImageCacheOptions,
  ImageCacheResult,
  ImageKind,
  ImageRenderer,
  ImageRequest,
} from './types'

export const DEFAULT_IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024

type InFlightRender = {
  png: Promise<Buffer>
  controller: AbortController
  /** requests still waiting for the PNG */
  waiting: number
}

/**
 * Keeps the rendered PNGs in memory, bounded by their total size, keyed by image and map version.
 * Concurrent requests of the same image share a single render, which is only aborted once all of
 * them have left, so a client disconnecting never fails the others.
 * @param components - metrics, for the hit/miss counter and the size gauge.
 * @param options - the byte budget.
 * @returns the image cache component.
 */
export function createImageCache(
  components: Pick<AppComponents, 'metrics'>,
  options: ImageCacheOptions
): IImageCacheComponent {
  const { metrics } = components
  // lru-cache directly: @dcl/memory-cache-component bounds by entry count, not by bytes
  const cache = new LRUCache<string, Buffer>({
    maxSize: options.maxBytes,
    sizeCalculation: (png) => Math.max(png.byteLength, 1),
  })
  const inFlight = new Map<string, InFlightRender>()
  let currentVersion = -Infinity

  function count(kind: ImageKind, result: ImageCacheResult): void {
    metrics.increment('dcl_map_image_cache_total', { kind, result })
  }

  function updateSize(): void {
    metrics.observe('dcl_map_image_cache_bytes', {}, cache.calculatedSize)
  }

  // the images of older versions are never served again, so they are dropped together
  function advanceVersion(version: number): void {
    if (version > currentVersion) {
      currentVersion = version
      cache.clear()
      updateSize()
    }
  }

  function startRender(
    cacheKey: string,
    version: number,
    render: ImageRenderer
  ): InFlightRender {
    const controller = new AbortController()
    const png = render(controller.signal)
      .then((result) => {
        if (version === currentVersion) {
          cache.set(cacheKey, result)
          updateSize()
        }
        return result
      })
      .finally(() => {
        if (inFlight.get(cacheKey) === entry) {
          inFlight.delete(cacheKey)
        }
      })
    // every waiter may have left, so nobody else may observe the failure
    png.catch(() => undefined)
    const entry: InFlightRender = { png, controller, waiting: 0 }
    inFlight.set(cacheKey, entry)
    return entry
  }

  function waitFor(
    entry: InFlightRender,
    signal: AbortSignal | undefined
  ): Promise<Buffer> {
    entry.waiting++
    if (!signal) {
      return entry.png
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        entry.waiting--
        if (entry.waiting === 0) {
          entry.controller.abort()
        }
        reject(new RenderAbortedError('The request was aborted'))
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      entry.png.then(
        (png) => {
          signal.removeEventListener('abort', onAbort)
          resolve(png)
        },
        (error) => {
          signal.removeEventListener('abort', onAbort)
          reject(error)
        }
      )
    })
  }

  function getOrRender(
    request: ImageRequest,
    render: ImageRenderer
  ): Promise<Buffer> {
    const { kind, key, version, signal } = request
    advanceVersion(version)
    const cacheKey = `${kind}|${key}|${version}`
    const cached = cache.get(cacheKey)
    if (cached) {
      count(kind, 'hit')
      return Promise.resolve(cached)
    }
    let entry = inFlight.get(cacheKey)
    // a render aborted by its last waiter can't serve a new one
    if (entry && !entry.controller.signal.aborted) {
      count(kind, 'shared')
    } else {
      count(kind, 'miss')
      entry = startRender(cacheKey, version, render)
    }
    return waitFor(entry, signal)
  }

  return {
    getOrRender,
    recordNotModified: (kind) => count(kind, 'not_modified'),
  }
}

/**
 * Builds the image cache from config: IMAGE_CACHE_MAX_BYTES bytes, 64 MB by default.
 * @param components - config, logs and metrics.
 * @returns the image cache component.
 */
export async function createImageCacheComponent(
  components: Pick<AppComponents, 'config' | 'logs' | 'metrics'>
): Promise<IImageCacheComponent> {
  const { config, logs, metrics } = components
  const logger = logs.getLogger('image-cache')
  const value = await config.getString('IMAGE_CACHE_MAX_BYTES')
  let maxBytes = DEFAULT_IMAGE_CACHE_MAX_BYTES
  if (value !== undefined && value !== '') {
    if (/^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))) {
      maxBytes = Number(value)
    } else {
      logger.warn('Invalid IMAGE_CACHE_MAX_BYTES, using the default', {
        value,
        defaultValue: DEFAULT_IMAGE_CACHE_MAX_BYTES,
      })
    }
  }
  return createImageCache({ metrics }, { maxBytes })
}
