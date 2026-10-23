import {
  buildTile,
  createFixtureMap,
  FixtureMap,
  startTestServer,
  TestServer,
} from '../harness'
import { TileType } from '../../src/modules/map/types'
import {
  IMAGE_CACHE_CONTROL,
  VERSIONED_IMAGE_CACHE_CONTROL,
} from '../../src/logic/image-http-cache'

const MAP_VERSION = Date.UTC(2026, 0, 1, 12, 0, 0) + 250
const LAND_VERSION = '0123456789abcdef'
const SMALL = 'width=100&height=100&size=10'
const ON_SALE = `/v2/map.png?${SMALL}&on-sale=true`

const LAND_HEADERS = {
  etag: expect.stringMatching(new RegExp(`^W/"${LAND_VERSION}-[0-9a-f]{16}"$`)),
  lastModified: null,
}
const OVERLAY_VERSION = 'ffffffffffffffff'
const OVERLAY_HEADERS = {
  etag: expect.stringMatching(
    new RegExp(`^W/"${OVERLAY_VERSION}-[0-9a-f]{16}"$`)
  ),
  lastModified: null,
}

// images without overlays follow the land version, the others the overlay version
const PNG_ROUTES = [
  [`/v1/map.png?${SMALL}&center=0,0`, LAND_HEADERS],
  [`/v2/map.png?${SMALL}&center=0,0`, LAND_HEADERS],
  [`/v1/parcels/0/0/map.png?${SMALL}`, LAND_HEADERS],
  [`/v2/parcels/0/0/map.png?${SMALL}`, LAND_HEADERS],
  [`/v1/estates/7/map.png?${SMALL}`, LAND_HEADERS],
  [`/v2/estates/7/map.png?${SMALL}`, LAND_HEADERS],
  ['/v1/minimap.png', LAND_HEADERS],
  ['/v1/estatemap.png', LAND_HEADERS],
  [`${ON_SALE}&center=0,0`, OVERLAY_HEADERS],
  [`/v2/parcels/0/0/map.png?${SMALL}&listed-for-rent=true`, OVERLAY_HEADERS],
  [`/v2/estates/7/map.png?${SMALL}&on-sale=true`, OVERLAY_HEADERS],
] as const

function readCacheHeaders(response: Response) {
  return {
    status: response.status,
    cacheControl: response.headers.get('cache-control'),
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  }
}

describe('when requesting map images that can be cached', () => {
  let server: TestServer
  let map: FixtureMap
  let render: jest.SpyInstance
  let response: Response

  beforeEach(async () => {
    map = createFixtureMap({
      lastUpdatedAt: MAP_VERSION,
      landVersion: LAND_VERSION,
      overlayVersion: OVERLAY_VERSION,
      tiles: [
        buildTile('0,0', { type: TileType.PLAZA }),
        buildTile('1,0', { type: TileType.OWNED, estateId: '7' }),
        buildTile('2,0', { type: TileType.OWNED, estateId: '7', left: true }),
      ],
    })
    server = await startTestServer({ map })
    render = jest.spyOn(server.components.renderPool, 'render')
  })

  afterEach(async () => {
    render.mockRestore()
    await server.stop()
  })

  describe.each(PNG_ROUTES)('and %s is requested', (path, versionHeaders) => {
    beforeEach(async () => {
      response = await server.fetch(path)
      await response.arrayBuffer()
    })

    it('should respond with a 200 that the CDN revalidates after 5 minutes and the ETag of its version', () => {
      expect(readCacheHeaders(response)).toEqual({
        status: 200,
        cacheControl:
          'public, max-age=60, s-maxage=300, stale-while-revalidate=86400',
        ...versionHeaders,
      })
    })

    describe('and it is requested again', () => {
      beforeEach(async () => {
        render.mockClear()
        response = await server.fetch(path)
        await response.arrayBuffer()
      })

      it('should serve it from memory without rendering it', () => {
        expect({
          status: response.status,
          renders: render.mock.calls.length,
        }).toEqual({ status: 200, renders: 0 })
      })
    })

    describe('and it is requested again with its ETag', () => {
      let etag: string | null

      beforeEach(async () => {
        etag = response.headers.get('etag')
        render.mockClear()
        response = await server.fetch(path, {
          headers: { 'If-None-Match': etag ?? '' },
        })
      })

      it('should respond with a 304 holding the ETag and the cache policy', () => {
        expect({
          status: response.status,
          etag: response.headers.get('etag'),
          cacheControl: response.headers.get('cache-control'),
        }).toEqual({ status: 304, etag, cacheControl: IMAGE_CACHE_CONTROL })
      })

      it('should not render it', () => {
        expect(render).not.toHaveBeenCalled()
      })
    })
  })

  describe.each([
    ['without overlays', `/v2/map.png?${SMALL}`],
    ['with overlays', ON_SALE],
  ])(
    'and an image %s is requested with only If-Modified-Since',
    (_name, path) => {
      beforeEach(async () => {
        response = await server.fetch(path, {
          headers: { 'If-Modified-Since': new Date(MAP_VERSION).toUTCString() },
        })
        await response.arrayBuffer()
      })

      it('should respond with a 200, as only its ETag identifies its version', () => {
        expect(response.status).toBe(200)
      })
    }
  )

  describe('and equivalent URLs of the same image are requested', () => {
    let etags: (string | null)[]

    beforeEach(async () => {
      const responses = []
      for (const path of [
        '/v2/map.png?width=100&height=100&size=10&center=0,0&selected=1,0;2,0',
        '/v1/map.png?selected=2,0;1,0;2,0&center=0,0&size=10&height=100&width=100',
      ]) {
        const each = await server.fetch(path)
        await each.arrayBuffer()
        responses.push(each)
      }
      etags = responses.map((each) => each.headers.get('etag'))
    })

    it('should render them once', () => {
      expect(render).toHaveBeenCalledTimes(1)
    })

    it('should give them the same ETag', () => {
      expect(etags[0]).toBe(etags[1])
    })
  })

  describe('and the selection is outside the image', () => {
    let etags: Set<string | null>

    beforeEach(async () => {
      etags = new Set()
      for (let i = 0; i < 1000; i++) {
        const each = await server.fetch(
          `/v2/map.png?${SMALL}&center=0,0&selected=1,0;${100 + i},${i}`
        )
        await each.arrayBuffer()
        etags.add(each.headers.get('etag'))
      }
    })

    it('should render and keep a single image', () => {
      expect({ etags: etags.size, renders: render.mock.calls.length }).toEqual({
        etags: 1,
        renders: 1,
      })
    })
  })

  describe('and the same image is requested concurrently', () => {
    let statuses: number[]

    beforeEach(async () => {
      const responses = await Promise.all(
        [1, 2, 3].map(() => server.fetch(`/v2/map.png?${SMALL}&center=5,5`))
      )
      await Promise.all(responses.map((each) => each.arrayBuffer()))
      statuses = responses.map((each) => each.status)
    })

    it('should render it once and serve it to every request', () => {
      expect({ statuses, renders: render.mock.calls.length }).toEqual({
        statuses: [200, 200, 200],
        renders: 1,
      })
    })
  })

  describe.each([
    ['the land changes', `/v2/map.png?${SMALL}`, true],
    ['only a price changes', ON_SALE, true],
    ['only a price changes', `/v2/map.png?${SMALL}`, false],
  ])('and %s between two requests of %s', (change, path, changes) => {
    let etags: (string | null)[]

    beforeEach(async () => {
      const first = await server.fetch(path)
      await first.arrayBuffer()
      map.getLastUpdatedAt.mockReturnValue(MAP_VERSION + 60_000)
      map.getOverlayVersion.mockReturnValue('eeeeeeeeeeeeeeee')
      if (change === 'the land changes') {
        map.getLandVersion.mockReturnValue('fedcba9876543210')
      }
      const second = await server.fetch(path)
      await second.arrayBuffer()
      etags = [first.headers.get('etag'), second.headers.get('etag')]
    })

    it(`should ${changes ? '' : 'not '}render the image again and ${
      changes ? '' : 'not '
    }change its ETag`, () => {
      expect({
        renders: render.mock.calls.length,
        sameEtag: etags[0] === etags[1],
      }).toEqual({ renders: changes ? 2 : 1, sameEtag: !changes })
    })
  })

  describe('and the render fails', () => {
    let statuses: number[]

    beforeEach(async () => {
      render.mockRejectedValueOnce(new Error('Canvas failure'))
      const failed = await server.fetch(`/v2/map.png?${SMALL}`)
      await failed.arrayBuffer()
      const next = await server.fetch(`/v2/map.png?${SMALL}`)
      await next.arrayBuffer()
      statuses = [failed.status, next.status]
    })

    it('should render it again on the next request', () => {
      expect({ statuses, renders: render.mock.calls.length }).toEqual({
        statuses: [500, 200],
        renders: 2,
      })
    })
  })

  describe.each([
    ['without overlays', `/v2/map.png?${SMALL}&v=${LAND_VERSION}`],
    ['with overlays', `${ON_SALE}&v=${OVERLAY_VERSION}`],
  ])(
    'and the image %s is requested pinned to its current version',
    (_name, path) => {
      beforeEach(async () => {
        response = await server.fetch(path)
        await response.arrayBuffer()
      })

      it('should let it be cached for a year as immutable', () => {
        expect({
          status: response.status,
          cacheControl: response.headers.get('cache-control'),
        }).toEqual({ status: 200, cacheControl: VERSIONED_IMAGE_CACHE_CONTROL })
      })
    }
  )

  describe('and the image is requested pinned to another version', () => {
    beforeEach(async () => {
      response = await server.fetch(`/v2/map.png?${SMALL}&v=${OVERLAY_VERSION}`)
      await response.arrayBuffer()
    })

    it('should serve the current image with the standard cache policy', () => {
      expect({
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
      }).toEqual({ status: 200, cacheControl: IMAGE_CACHE_CONTROL })
    })
  })

  describe('and the image is pinned to a version after it was cached without one', () => {
    beforeEach(async () => {
      const first = await server.fetch(`/v2/map.png?${SMALL}`)
      await first.arrayBuffer()
      response = await server.fetch(`/v2/map.png?${SMALL}&v=${LAND_VERSION}`)
      await response.arrayBuffer()
    })

    it('should serve it from memory', () => {
      expect(render).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the image params are invalid', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/map.png?center=foo')
      await response.arrayBuffer()
    })

    it('should respond with a 400 without a public cache policy', () => {
      expect(readCacheHeaders(response)).toEqual({
        status: 400,
        cacheControl: null,
        etag: null,
        lastModified: null,
      })
    })
  })

  describe('and the image of an estate without parcels is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/estates/1000/map.png', {
        redirect: 'manual',
      })
    })

    it('should redirect with a short cache policy', () => {
      expect({
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
      }).toEqual({
        status: 302,
        cacheControl: 'max-age=60, s-maxage=60, public',
      })
    })
  })

  describe('and the map is not ready', () => {
    beforeEach(async () => {
      map.setReady(false)
      map.isReady.mockReturnValue(false)
      response = await server.fetch(`/v2/map.png?${SMALL}`)
      await response.arrayBuffer()
    })

    it('should respond with a 503 without caching headers', () => {
      expect(readCacheHeaders(response)).toEqual({
        status: 503,
        cacheControl: null,
        etag: null,
        lastModified: null,
      })
    })
  })
})
