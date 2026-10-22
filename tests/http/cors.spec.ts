import {
  createFixtureMap,
  FixtureMap,
  startTestServer,
  TestServer,
} from '../harness'

describe('when the server allows any origin', () => {
  let server: TestServer
  let map: FixtureMap
  let response: Response

  beforeEach(async () => {
    map = createFixtureMap()
    server = await startTestServer({ map })
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('and a GET request without an Origin header is served', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/ping')
    })

    it('should respond with Access-Control-Allow-Origin set to any origin', () => {
      expect(response.headers.get('access-control-allow-origin')).toBe('*')
    })
  })

  describe('and a request to an unknown route is served', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/unknown')
    })

    it('should respond with a 404 that allows any origin', () => {
      expect({
        status: response.status,
        allowOrigin: response.headers.get('access-control-allow-origin'),
      }).toEqual({ status: 404, allowOrigin: '*' })
    })
  })

  describe('and a preflight request is served', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/tiles', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://app.example.com',
          'Access-Control-Request-Method': 'GET',
        },
      })
    })

    it('should respond with a successful status that allows any origin', () => {
      expect({
        ok: response.ok,
        allowOrigin: response.headers.get('access-control-allow-origin'),
      }).toEqual({ ok: true, allowOrigin: '*' })
    })
  })

  describe('and a handler throws an unexpected error', () => {
    beforeEach(async () => {
      map.getParcel.mockRejectedValueOnce(new Error('Unexpected failure'))
      response = await server.fetch('/v2/parcels/1/0')
    })

    it('should respond with a 500 that allows any origin', () => {
      expect({
        status: response.status,
        allowOrigin: response.headers.get('access-control-allow-origin'),
      }).toEqual({ status: 500, allowOrigin: '*' })
    })
  })
})
