import {
  getImageCacheHeaders,
  IMAGE_CACHE_CONTROL,
  ImageCacheHeaders,
  isNotModified,
  VERSIONED_IMAGE_CACHE_CONTROL,
} from '../../src/logic/image-http-cache'

const VERSION = '0123456789abcdef'

describe('when building the caching headers of an image', () => {
  let url: URL
  let headers: ImageCacheHeaders

  describe('and the URL has no version', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v2/map.png')
      headers = getImageCacheHeaders(VERSION, 'map|a', url)
    })

    it('should give a weak ETag of the version and the request, the short CDN policy and no Last-Modified', () => {
      expect(headers).toEqual({
        etag: expect.stringMatching(/^W\/"0123456789abcdef-[0-9a-f]{16}"$/),
        'cache-control':
          'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
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

  describe('and the URL is pinned to the current version', () => {
    beforeEach(() => {
      url = new URL(`http://localhost/v2/map.png?v=${VERSION}`)
      headers = getImageCacheHeaders(VERSION, 'map|a', url)
    })

    it('should let it be cached for a year as immutable', () => {
      expect(headers['cache-control']).toBe(VERSIONED_IMAGE_CACHE_CONTROL)
    })
  })

  describe('and the URL is pinned to another version', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v2/map.png?v=fedcba9876543210')
      headers = getImageCacheHeaders(VERSION, 'map|a', url)
    })

    it('should use the short CDN policy', () => {
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
      expect(isNotModified(requestHeaders, etag)).toBe(expected)
    })
  })

  describe('and only If-Modified-Since is sent', () => {
    beforeEach(() => {
      requestHeaders = new Headers({
        'if-modified-since': new Date().toUTCString(),
      })
    })

    it('should return false, as images have no modification time', () => {
      expect(isNotModified(requestHeaders, etag)).toBe(false)
    })
  })

  describe('and no conditional header is sent', () => {
    beforeEach(() => {
      requestHeaders = new Headers()
    })

    it('should return false', () => {
      expect(isNotModified(requestHeaders, etag)).toBe(false)
    })
  })
})
