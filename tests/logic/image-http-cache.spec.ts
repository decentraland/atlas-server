import {
  getImageCacheHeaders,
  IMAGE_CACHE_CONTROL,
  ImageCacheHeaders,
  ImageVersion,
  isNotModified,
  VERSIONED_IMAGE_CACHE_CONTROL,
} from '../../src/logic/image-http-cache'

const UPDATED_AT = Date.UTC(2026, 0, 1, 12, 0, 0) + 250
const MAP_VERSION: ImageVersion = {
  value: String(UPDATED_AT),
  updatedAt: UPDATED_AT,
}
const LAND_VERSION: ImageVersion = { value: '0123456789abcdef' }

describe('when building the caching headers of an image', () => {
  let url: URL
  let headers: ImageCacheHeaders

  describe('and its version is the map update time', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v2/map.png?on-sale=true')
      headers = getImageCacheHeaders(MAP_VERSION, 'map|a', url)
    })

    it('should give a weak ETag of the version and the request, the update time as Last-Modified and the short CDN policy', () => {
      expect(headers).toEqual({
        etag: expect.stringMatching(
          new RegExp(`^W/"${UPDATED_AT}-[0-9a-f]{16}"$`)
        ),
        'last-modified': new Date(UPDATED_AT).toUTCString(),
        'cache-control':
          'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
      })
    })
  })

  describe('and its version is the land version', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v2/map.png')
      headers = getImageCacheHeaders(LAND_VERSION, 'map|a', url)
    })

    it('should give a weak ETag of the land version and no Last-Modified', () => {
      expect(headers).toEqual({
        etag: expect.stringMatching(/^W\/"0123456789abcdef-[0-9a-f]{16}"$/),
        'cache-control': IMAGE_CACHE_CONTROL,
      })
    })
  })

  describe('and another request is described', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v2/map.png')
      headers = getImageCacheHeaders(LAND_VERSION, 'map|b', url)
    })

    it('should give another ETag', () => {
      expect(headers.etag).not.toBe(
        getImageCacheHeaders(LAND_VERSION, 'map|a', url).etag
      )
    })
  })

  describe('and the URL is pinned to the current version', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v2/map.png?v=${LAND_VERSION.value}`)
      headers = getImageCacheHeaders(LAND_VERSION, 'map|a', url)
    })

    it('should let it be cached for a year as immutable', () => {
      expect(headers['cache-control']).toBe(VERSIONED_IMAGE_CACHE_CONTROL)
    })
  })

  describe('and the URL is pinned to another version', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v2/map.png?v=${UPDATED_AT}`)
      headers = getImageCacheHeaders(LAND_VERSION, 'map|a', url)
    })

    it('should use the short CDN policy', () => {
      expect(headers['cache-control']).toBe(IMAGE_CACHE_CONTROL)
    })
  })
})

describe('when checking whether the client holds the current image', () => {
  const etag = `W/"${UPDATED_AT}-0123456789abcdef"`
  let requestHeaders: Headers

  describe.each([
    ['the same weak ETag', etag, true],
    ['the same ETag as a strong one', `"${UPDATED_AT}-0123456789abcdef"`, true],
    ['a list holding the ETag', `W/"1-aaaa", ${etag}`, true],
    ['a wildcard', '*', true],
    ['another ETag', 'W/"1-0123456789abcdef"', false],
  ])('and If-None-Match is %s', (_name, ifNoneMatch, expected) => {
    beforeEach(() => {
      requestHeaders = new Headers({ 'if-none-match': ifNoneMatch })
    })

    it(`should return ${expected}`, () => {
      expect(isNotModified(requestHeaders, etag, MAP_VERSION)).toBe(expected)
    })
  })

  describe('and If-None-Match does not match but If-Modified-Since is current', () => {
    beforeEach(() => {
      requestHeaders = new Headers({
        'if-none-match': 'W/"1-0123456789abcdef"',
        'if-modified-since': new Date(UPDATED_AT).toUTCString(),
      })
    })

    it('should ignore If-Modified-Since and return false', () => {
      expect(isNotModified(requestHeaders, etag, MAP_VERSION)).toBe(false)
    })
  })

  describe.each([
    ['the Last-Modified sent, truncated to seconds', UPDATED_AT, true],
    ['later than the map version', UPDATED_AT + 60_000, true],
    ['older than the map version', UPDATED_AT - 60_000, false],
  ])('and If-Modified-Since is %s', (_name, since, expected) => {
    beforeEach(() => {
      requestHeaders = new Headers({
        'if-modified-since': new Date(since).toUTCString(),
      })
    })

    it(`should return ${expected}`, () => {
      expect(isNotModified(requestHeaders, etag, MAP_VERSION)).toBe(expected)
    })
  })

  describe('and If-Modified-Since is sent for an image versioned by the land', () => {
    beforeEach(() => {
      requestHeaders = new Headers({
        'if-modified-since': new Date(UPDATED_AT).toUTCString(),
      })
    })

    it('should return false, as it has no modification time', () => {
      expect(isNotModified(requestHeaders, etag, LAND_VERSION)).toBe(false)
    })
  })

  describe('and If-Modified-Since is not a date', () => {
    beforeEach(() => {
      requestHeaders = new Headers({ 'if-modified-since': 'yesterday' })
    })

    it('should return false', () => {
      expect(isNotModified(requestHeaders, etag, MAP_VERSION)).toBe(false)
    })
  })

  describe('and no conditional header is sent', () => {
    beforeEach(() => {
      requestHeaders = new Headers()
    })

    it('should return false', () => {
      expect(isNotModified(requestHeaders, etag, MAP_VERSION)).toBe(false)
    })
  })
})
