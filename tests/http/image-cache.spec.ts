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
const SMALL = 'width=100&height=100&size=10'

const PNG_ROUTES = [
  `/v1/map.png?${SMALL}&center=0,0`,
  `/v2/map.png?${SMALL}&center=0,0`,
  `/v1/parcels/0/0/map.png?${SMALL}`,
  `/v2/parcels/0/0/map.png?${SMALL}`,
  `/v1/estates/7/map.png?${SMALL}`,
  `/v2/estates/7/map.png?${SMALL}`,
  '/v1/minimap.png',
  '/v1/estatemap.png',
]

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

  describe.each(PNG_ROUTES)('and %s is requested', (path) => {
    beforeEach(async () => {
      response = await server.fetch(path)
      await response.arrayBuffer()
    })

    it('should respond with a 200 that the CDN may keep for a day, its ETag and Last-Modified', () => {
      expect(readCacheHeaders(response)).toEqual({
        status: 200,
        cacheControl: IMAGE_CACHE_CONTROL,
        etag: expect.stringMatching(
          new RegExp(`^W/"${MAP_VERSION}-[0-9a-f]{16}"$`)
        ),
        lastModified: new Date(MAP_VERSION).toUTCString(),
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

  describe('and an image is first requested with If-Modified-Since of the map version', () => {
    beforeEach(async () => {
      response = await server.fetch(`/v2/map.png?${SMALL}`, {
        headers: { 'If-Modified-Since': new Date(MAP_VERSION).toUTCString() },
      })
    })

    it('should respond with a 304 with the image cache policy', () => {
      expect({
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
      }).toEqual({ status: 304, cacheControl: IMAGE_CACHE_CONTROL })
    })

    it('should not render it', () => {
      expect(render).not.toHaveBeenCalled()
    })
  })

  describe('and an image is requested with a stale ETag and a current If-Modified-Since', () => {
    beforeEach(async () => {
      response = await server.fetch(`/v2/map.png?${SMALL}`, {
        headers: {
          'If-None-Match': 'W/"1-0123456789abcdef"',
          'If-Modified-Since': new Date(MAP_VERSION).toUTCString(),
        },
      })
      await response.arrayBuffer()
    })

    it('should respond with a 200, as If-None-Match takes precedence', () => {
      expect(response.status).toBe(200)
    })
  })

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

  describe('and the map changes between two requests', () => {
    let etags: (string | null)[]

    beforeEach(async () => {
      const first = await server.fetch(`/v2/map.png?${SMALL}`)
      await first.arrayBuffer()
      map.getLastUpdatedAt.mockReturnValue(MAP_VERSION + 60_000)
      const second = await server.fetch(`/v2/map.png?${SMALL}`)
      await second.arrayBuffer()
      etags = [first.headers.get('etag'), second.headers.get('etag')]
    })

    it('should render the image again', () => {
      expect(render).toHaveBeenCalledTimes(2)
    })

    it('should give it a new ETag', () => {
      expect(etags[0]).not.toBe(etags[1])
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

  describe('and the image is requested pinned to the current map version', () => {
    beforeEach(async () => {
      response = await server.fetch(`/v2/map.png?${SMALL}&v=${MAP_VERSION}`)
      await response.arrayBuffer()
    })

    it('should let it be cached for a year as immutable', () => {
      expect({
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
      }).toEqual({ status: 200, cacheControl: VERSIONED_IMAGE_CACHE_CONTROL })
    })
  })

  describe('and the image is requested pinned to another map version', () => {
    beforeEach(async () => {
      response = await server.fetch(
        `/v2/map.png?${SMALL}&v=${MAP_VERSION - 1000}`
      )
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
      response = await server.fetch(`/v2/map.png?${SMALL}&v=${MAP_VERSION}`)
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
