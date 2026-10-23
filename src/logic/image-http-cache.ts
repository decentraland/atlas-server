import { createHash } from 'crypto'

// the CDN revalidates after 5 minutes, which costs a 304 while the image is unchanged
export const IMAGE_CACHE_CONTROL =
  'public, max-age=60, s-maxage=300, stale-while-revalidate=86400'
// a URL pinned to the image's current version (?v=) never changes
export const VERSIONED_IMAGE_CACHE_CONTROL =
  'public, max-age=31536000, immutable'
// the dissolved estate redirect, as the last-modified middleware sets for redirects
export const REDIRECT_CACHE_CONTROL = 'max-age=60, s-maxage=60, public'

export type ImageCacheHeaders = {
  etag: string
  'cache-control': string
}

/**
 * Builds the caching headers of a map image. There is no Last-Modified: the versions are
 * fingerprints of the data, the same on every replica, rather than times.
 * @param version - the image's version: the land version, or the overlay version for images with overlays.
 * @param key - the normalized request, so equivalent URLs share an ETag.
 * @param url - the request URL; its `v` param pins the response to a version.
 * @returns the ETag and Cache-Control headers.
 */
export function getImageCacheHeaders(
  version: string,
  key: string,
  url: URL
): ImageCacheHeaders {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
  return {
    etag: `W/"${version}-${hash}"`,
    'cache-control':
      url.searchParams.get('v') === version
        ? VERSIONED_IMAGE_CACHE_CONTROL
        : IMAGE_CACHE_CONTROL,
  }
}

function toOpaqueTag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}

/**
 * Tells whether the client already holds the image, by If-None-Match (RFC 9110 13.1.2, weak
 * comparison). Without a Last-Modified, If-Modified-Since never applies.
 * @param headers - the request headers.
 * @param etag - the image's current ETag.
 * @returns true when a 304 can be answered.
 */
export function isNotModified(
  headers: Pick<Headers, 'get'>,
  etag: string
): boolean {
  const ifNoneMatch = headers.get('if-none-match')
  if (ifNoneMatch === null) {
    return false
  }
  const current = toOpaqueTag(etag)
  return ifNoneMatch
    .split(',')
    .map((tag) => tag.trim())
    .some((tag) => tag === '*' || toOpaqueTag(tag) === current)
}
