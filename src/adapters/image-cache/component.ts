import { createHash } from 'crypto'
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
  ImageVersionScope,
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
 * @param options - the byte budget; 0 keeps nothing, while still sharing concurrent renders.
 * @returns the image cache component.
 */
export function createImageCache(
  components: Pick<AppComponents, 'metrics'>,
  options: ImageCacheOptions
): IImageCacheComponent {
  const { metrics } = components
  // lru-cache directly: @dcl/memory-cache-component bounds by entry count, not by bytes
  const cache =
    options.maxBytes > 0
      ? new LRUCache<string, Buffer>({
          maxSize: options.maxBytes,
          sizeCalculation: (png, key) => png.byteLength + key.length,
        })
      : undefined
  const inFlight = new Map<string, InFlightRender>()
  const currentVersions = new Map<ImageVersionScope, string>()

  function count(kind: ImageKind, result: ImageCacheResult): void {
    metrics.increment('dcl_map_image_cache_total', { kind, result })
  }

  function updateSize(): void {
    metrics.observe('dcl_map_image_cache_bytes', {}, cache?.calculatedSize ?? 0)
  }

  // the images of a replaced version are never served again, so they are dropped together
  function useVersion(scope: ImageVersionScope, version: string): void {
    const previous = currentVersions.get(scope)
    if (previous === version) {
      return
    }
    currentVersions.set(scope, version)
    if (cache && previous !== undefined) {
      const prefix = `${scope}:${previous}:`
      for (const key of Array.from(cache.keys())) {
        if (key.startsWith(prefix)) {
          cache.delete(key)
        }
      }
      updateSize()
    }
  }

  // a fixed size key, whatever the length of the request
  function getCacheKey(request: ImageRequest): string {
    const hash = createHash('sha256')
      .update(`${request.kind}|${request.key}`)
      .digest('hex')
    return `${request.scope}:${request.version}:${hash}`
  }

  function startRender(
    cacheKey: string,
    request: ImageRequest,
    render: ImageRenderer
  ): InFlightRender {
    const { scope, version } = request
    const controller = new AbortController()
    const png = render(controller.signal)
      .then((result) => {
        if (cache && currentVersions.get(scope) === version) {
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
    return new Promise((resolve, reject) => {
      let waiting = true
      function leave(): void {
        if (waiting) {
          waiting = false
          entry.waiting--
          signal?.removeEventListener('abort', onAbort)
        }
      }
      function onAbort(): void {
        leave()
        if (entry.waiting === 0) {
          entry.controller.abort()
        }
        reject(new RenderAbortedError('The request was aborted'))
      }
      if (signal?.aborted) {
        onAbort()
        return
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      entry.png.then(
        (png) => {
          leave()
          resolve(png)
        },
        (error) => {
          leave()
          reject(error)
        }
      )
    })
  }

  function getOrRender(
    request: ImageRequest,
    render: ImageRenderer
  ): Promise<Buffer> {
    const { kind, signal } = request
    useVersion(request.scope, request.version)
    const cacheKey = getCacheKey(request)
    const cached = cache?.get(cacheKey)
    if (cached) {
      count(kind, 'hit')
      return Promise.resolve(cached)
    }
    const entry = inFlight.get(cacheKey)
    if (!entry) {
      count(kind, 'miss')
      return waitFor(startRender(cacheKey, request, render), signal)
    }
    count(kind, 'shared')
    if (!entry.controller.signal.aborted) {
      return waitFor(entry, signal)
    }
    // abandoned by its last waiter: once on a thread it still finishes and is kept,
    // and if it was stopped before that, this request renders it again
    return waitFor(entry, signal).catch((error) => {
      if (error instanceof RenderAbortedError && !signal?.aborted) {
        return getOrRender(request, render)
      }
      throw error
    })
  }

  return {
    getOrRender,
    record: count,
  }
}

/**
 * Builds the image cache from config: IMAGE_CACHE_MAX_BYTES bytes, 64 MB by default; 0 keeps nothing.
 * @param components - config, logs and metrics.
 * @returns the image cache component.
 */
export async function createImageCacheComponent(
  components: Pick<AppComponents, 'config' | 'logs' | 'metrics'>
): Promise<IImageCacheComponent> {
  const { config, logs, metrics } = components
  const logger = logs.getLogger('image-cache')
  // a plain count of bytes: getNumber would read "64MB" or "1e6" as numbers
  const value = (await config.getString('IMAGE_CACHE_MAX_BYTES'))?.trim()
  let maxBytes = DEFAULT_IMAGE_CACHE_MAX_BYTES
  if (value) {
    if (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))) {
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
