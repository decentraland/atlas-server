import { IBaseComponent } from '@well-known-components/interfaces'

/** The route an image is served by; it scopes the cache keys and labels the metrics. */
export type ImageKind = 'map' | 'parcel' | 'estate' | 'minimap' | 'estatemap'

/** How a request was answered: from memory, by a new render, by joining a running render, with a 304 or with the dissolved estate redirect. */
export type ImageCacheResult =
  | 'hit'
  | 'miss'
  | 'shared'
  | 'not_modified'
  | 'dissolved'

/**
 * What an image's version tracks: `land` for images without price or rental overlays,
 * which only change with the land, and `overlay` for the ones that draw them.
 */
export type ImageVersionScope = 'land' | 'overlay'

export type ImageRequest = {
  kind: ImageKind
  /** the normalized params of the image; equal keys must render equal images */
  key: string
  scope: ImageVersionScope
  /** the version of the scope the image is rendered from */
  version: string
  /** stops waiting for the image when the client disconnects */
  signal?: AbortSignal
}

/** Renders an image; the signal aborts once every request waiting for it has left. */
export type ImageRenderer = (signal: AbortSignal) => Promise<Buffer>

export type ImageCacheOptions = {
  /** the most bytes held in memory, keys included; the least recently used images are evicted first. 0 keeps nothing */
  maxBytes: number
}

export interface IImageCacheComponent extends IBaseComponent {
  /**
   * Returns the PNG of an image from memory, or renders it once for every concurrent request of it.
   * Images of replaced versions are never returned, and failed renders are not kept.
   * @param request - the image, its version and the request's abort signal.
   * @param render - renders the image on a miss.
   * @returns the PNG.
   * @throws RenderAbortedError when the request's signal aborts before the image is ready.
   * @throws whatever the render throws, to every request waiting for it.
   */
  getOrRender(request: ImageRequest, render: ImageRenderer): Promise<Buffer>
  /**
   * Counts a request answered without the cache, e.g. with a 304.
   * @param kind - the image's route.
   * @param result - how it was answered.
   */
  record(kind: ImageKind, result: 'not_modified' | 'dissolved'): void
}
