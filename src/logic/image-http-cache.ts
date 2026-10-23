import { createHash } from 'crypto'

// the CDN revalidates after 5 minutes, which costs a 304 while the image is unchanged
export const IMAGE_CACHE_CONTROL =
  'public, max-age=60, s-maxage=300, stale-while-revalidate=86400'
// a URL pinned to the image's current version (?v=) never changes
export const VERSIONED_IMAGE_CACHE_CONTROL =
  'public, max-age=31536000, immutable'
// the dissolved estate redirect, as the last-modified middleware sets for redirects
export const REDIRECT_CACHE_CONTROL = 'max-age=60, s-maxage=60, public'

/**
 * The version an image is rendered from: the land version for images without overlays, which
 * is derived from the data, or the map's last update time for the ones with price or rental overlays.
 */
export type ImageVersion = {
  value: string
  /** the time of the version in ms, when it has one; it backs Last-Modified and If-Modified-Since */
  updatedAt?: number
}

export type ImageCacheHeaders = {
  etag: string
  'last-modified'?: string
  'cache-control': string
}

/**
 * Builds the caching headers of a map image.
 * @param version - the image's version.
 * @param key - the normalized request, so equivalent URLs share an ETag.
 * @param url - the request URL; its `v` param pins the response to a version.
 * @returns the ETag, Cache-Control and, for time based versions, Last-Modified headers.
 */
export function getImageCacheHeaders(
  version: ImageVersion,
  key: string,
  url: URL
): ImageCacheHeaders {
  const hash = createHash('sha1').update(key).digest('hex').slice(0, 16)
  return {
    etag: `W/"${version.value}-${hash}"`,
    ...(version.updatedAt !== undefined
      ? { 'last-modified': new Date(version.updatedAt).toUTCString() }
      : {}),
    'cache-control':
      url.searchParams.get('v') === version.value
        ? VERSIONED_IMAGE_CACHE_CONTROL
        : IMAGE_CACHE_CONTROL,
  }
}

function toOpaqueTag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag
}

/**
 * Tells whether the client already holds the image (RFC 9110 13.1.2 and 13.1.3, weak comparison).
 * If-Modified-Since is only evaluated without If-None-Match, and only for time based versions.
 * @param headers - the request headers.
 * @param etag - the image's current ETag.
 * @param version - the image's version.
 * @returns true when a 304 can be answered.
 */
export function isNotModified(
  headers: Pick<Headers, 'get'>,
  etag: string,
  version: ImageVersion
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
  if (ifModifiedSince === null || version.updatedAt === undefined) {
    return false
  }
  const since = Date.parse(ifModifiedSince)
  // Last-Modified has a precision of seconds
  return !isNaN(since) && Math.floor(version.updatedAt / 1000) * 1000 <= since
}
