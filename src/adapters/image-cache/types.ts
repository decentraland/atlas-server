import { IBaseComponent } from '@well-known-components/interfaces'

/** The route an image is served by; it scopes the cache keys and labels the metrics. */
export type ImageKind = 'map' | 'parcel' | 'estate' | 'minimap' | 'estatemap'

/** How a request was answered: from memory, by a new render, by joining a running render, or with a 304. */
export type ImageCacheResult = 'hit' | 'miss' | 'shared' | 'not_modified'

export type ImageRequest = {
  kind: ImageKind
  /** the normalized params of the image; equal keys must render equal images */
  key: string
  /** the map version the image is rendered from, i.e. the map's last update time */
  version: number
  /** stops waiting for the image when the client disconnects */
  signal?: AbortSignal
}

/** Renders an image; the signal aborts once every request waiting for it has left. */
export type ImageRenderer = (signal: AbortSignal) => Promise<Buffer>

export type ImageCacheOptions = {
  /** the most PNG bytes held in memory; the least recently used images are evicted first */
  maxBytes: number
}

export interface IImageCacheComponent extends IBaseComponent {
  /**
   * Returns the PNG of an image from memory, or renders it once for every concurrent request of it.
   * Images of older map versions are never returned, and failed renders are not kept.
   * @param request - the image, its map version and the request's abort signal.
   * @param render - renders the image on a miss.
   * @returns the PNG.
   * @throws RenderAbortedError when the request's signal aborts before the image is ready.
   * @throws whatever the render throws, to every request waiting for it.
   */
  getOrRender(request: ImageRequest, render: ImageRenderer): Promise<Buffer>
  /**
   * Counts a request answered with a 304, which never reaches the cache.
   * @param kind - the image's route.
   */
  recordNotModified(kind: ImageKind): void
}
