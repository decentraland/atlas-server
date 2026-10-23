import {
  getImageCacheHeaders,
  IMAGE_CACHE_CONTROL,
  ImageCacheHeaders,
  isNotModified,
  VERSIONED_IMAGE_CACHE_CONTROL,
} from '../../src/logic/image-http-cache'

const VERSION = Date.UTC(2026, 0, 1, 12, 0, 0) + 250

describe('when building the caching headers of an image', () => {
  let url: URL
  let headers: ImageCacheHeaders

  describe('and the URL has no version', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v2/map.png')
      headers = getImageCacheHeaders(VERSION, 'map|a', url)
    })

    it('should give a weak ETag of the map version and the request, the version as Last-Modified and the CDN cache policy', () => {
      expect(headers).toEqual({
        etag: expect.stringMatching(
          new RegExp(`^W/"${VERSION}-[0-9a-f]{16}"$`)
        ),
        'last-modified': new Date(VERSION).toUTCString(),
        'cache-control': IMAGE_CACHE_CONTROL,
      })
    })
  })

  describe('and another request is described', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v2/map.png')
      headers = getImageCacheHeaders(VERSION, 'map|b', url)
    })

    it('should give another ETag', () => {
      expect(headers.etag).not.toBe(
        getImageCacheHeaders(VERSION, 'map|a', url).etag
      )
    })
  })

  describe('and the URL is pinned to the current map version', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v2/map.png?v=${VERSION}`)
      headers = getImageCacheHeaders(VERSION, 'map|a', url)
    })

    it('should let it be cached for a year as immutable', () => {
      expect(headers['cache-control']).toBe(VERSIONED_IMAGE_CACHE_CONTROL)
    })
  })

  describe('and the URL is pinned to another map version', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v2/map.png?v=${VERSION - 1}`)
      headers = getImageCacheHeaders(VERSION, 'map|a', url)
    })

    it('should use the CDN cache policy', () => {
      expect(headers['cache-control']).toBe(IMAGE_CACHE_CONTROL)
    })
  })
})

describe('when checking whether the client holds the current image', () => {
  const etag = `W/"${VERSION}-0123456789abcdef"`
  let requestHeaders: Headers

  describe.each([
    ['the same weak ETag', etag, true],
    ['the same ETag as a strong one', `"${VERSION}-0123456789abcdef"`, true],
    ['a list holding the ETag', `W/"1-aaaa", ${etag}`, true],
    ['a wildcard', '*', true],
    ['another ETag', 'W/"1-0123456789abcdef"', false],
  ])('and If-None-Match is %s', (_name, ifNoneMatch, expected) => {
    beforeEach(() => {
      requestHeaders = new Headers({ 'if-none-match': ifNoneMatch })
    })

    it(`should return ${expected}`, () => {
      expect(isNotModified(requestHeaders, etag, VERSION)).toBe(expected)
    })
  })

  describe('and If-None-Match does not match but If-Modified-Since is current', () => {
    beforeEach(() => {
      requestHeaders = new Headers({
        'if-none-match': 'W/"1-0123456789abcdef"',
        'if-modified-since': new Date(VERSION).toUTCString(),
      })
    })

    it('should ignore If-Modified-Since and return false', () => {
      expect(isNotModified(requestHeaders, etag, VERSION)).toBe(false)
    })
  })

  describe.each([
    ['the Last-Modified sent, truncated to seconds', VERSION, true],
    ['later than the map version', VERSION + 60_000, true],
    ['older than the map version', VERSION - 60_000, false],
  ])('and If-Modified-Since is %s', (_name, since, expected) => {
    beforeEach(() => {
      requestHeaders = new Headers({
        'if-modified-since': new Date(since).toUTCString(),
      })
    })

    it(`should return ${expected}`, () => {
      expect(isNotModified(requestHeaders, etag, VERSION)).toBe(expected)
    })
  })

  describe('and If-Modified-Since is not a date', () => {
    beforeEach(() => {
      requestHeaders = new Headers({ 'if-modified-since': 'yesterday' })
    })

    it('should return false', () => {
      expect(isNotModified(requestHeaders, etag, VERSION)).toBe(false)
    })
  })

  describe('and no conditional header is sent', () => {
    beforeEach(() => {
      requestHeaders = new Headers()
    })

    it('should return false', () => {
      expect(isNotModified(requestHeaders, etag, VERSION)).toBe(false)
    })
  })
})
