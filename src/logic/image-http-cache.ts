import { createHash } from 'crypto'

// images only change with the map, so the CDN may keep them for a day and refresh in the background
export const IMAGE_CACHE_CONTROL =
  'public, max-age=300, s-maxage=86400, stale-while-revalidate=86400'
// a URL pinned to the current map version (?v=<lastUpdatedAt>) never changes
export const VERSIONED_IMAGE_CACHE_CONTROL =
  'public, max-age=31536000, immutable'
// the dissolved estate redirect, as the last-modified middleware sets for redirects
export const REDIRECT_CACHE_CONTROL = 'max-age=60, s-maxage=60, public'

export type ImageCacheHeaders = {
  etag: string
  'last-modified': string
  'cache-control': string
}

/**
 * Builds the caching headers of a map image.
 * @param version - the map's last update time, in ms.
 * @param key - the normalized request, so equivalent URLs share an ETag.
 * @param url - the request URL; its `v` param pins the response to a map version.
 * @returns the ETag, Last-Modified and Cache-Control headers.
 */
export function getImageCacheHeaders(
  version: number,
  key: string,
  url: URL
): ImageCacheHeaders {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
  return {
    etag: `W/"${version}-${hash}"`,
    'last-modified': new Date(version).toUTCString(),
    'cache-control':
      url.searchParams.get('v') === String(version)
        ? VERSIONED_IMAGE_CACHE_CONTROL
        : IMAGE_CACHE_CONTROL,
  }
}

function toOpaqueTag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}

/**
 * Tells whether the client already holds the image (RFC 9110 13.1.2 and 13.1.3, weak comparison).
 * If-Modified-Since is only evaluated without If-None-Match.
 * @param headers - the request headers.
 * @param etag - the image's current ETag.
 * @param version - the map's last update time, in ms.
 * @returns true when a 304 can be answered.
 */
export function isNotModified(
  headers: Pick<Headers, 'get'>,
  etag: string,
  version: number
): boolean {
  const ifNoneMatch = headers.get('if-none-match')
  if (ifNoneMatch !== null) {
    const current = toOpaqueTag(etag)
    return ifNoneMatch
      .split(',')
      .map((tag) => tag.trim())
      .some((tag) => tag === '*' || toOpaqueTag(tag) === current)
  }
  const ifModifiedSince = headers.get('if-modified-since')
  if (ifModifiedSince === null) {
    return false
  }
  const since = Date.parse(ifModifiedSince)
  // Last-Modified has a precision of seconds
  return !isNaN(since) && Math.floor(version / 1000) * 1000 <= since
}
