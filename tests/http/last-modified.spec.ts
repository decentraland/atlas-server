import {
  buildNFT,
  createFixtureMap,
  startTestServer,
  TestServer,
} from '../harness'

describe('when requesting a resource cached by the map update time', () => {
  let server: TestServer
  let lastUpdatedAt: number
  let response: Response

  beforeEach(async () => {
    lastUpdatedAt = Date.UTC(2026, 0, 1, 12, 0, 0)
    server = await startTestServer({
      map: createFixtureMap({
        lastUpdatedAt,
        parcels: { '1,0': buildNFT('parcel-1-0') },
      }),
    })
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('and no If-Modified-Since header is sent', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/parcels/1/0')
    })

    it('should respond with a 200 and the map update time as Last-Modified', () => {
      expect({
        status: response.status,
        lastModified: response.headers.get('last-modified'),
      }).toEqual({
        status: 200,
        lastModified: new Date(lastUpdatedAt).toUTCString(),
      })
    })
  })

  describe('and the If-Modified-Since header matches the map update time', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/parcels/1/0', {
        headers: {
          'If-Modified-Since': new Date(lastUpdatedAt).toUTCString(),
        },
      })
    })

    it('should respond with a 304 without a body', async () => {
      expect({
        status: response.status,
        body: await response.text(),
      }).toEqual({ status: 304, body: '' })
    })
  })

  describe('and the If-Modified-Since header is older than the map update time', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/parcels/1/0', {
        headers: {
          'If-Modified-Since': new Date(lastUpdatedAt - 60_000).toUTCString(),
        },
      })
    })

    it('should respond with a 200', () => {
      expect(response.status).toBe(200)
    })
  })
})
