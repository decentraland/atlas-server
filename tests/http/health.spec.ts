import { startTestServer, TestServer, createFixtureMap } from '../harness'

describe('when the map has not finished its first load', () => {
  let server: TestServer
  let response: Response

  beforeEach(async () => {
    server = await startTestServer()
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('and the readiness probe is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/health/ready')
    })

    it('should respond with a 503 and the map probe failing', async () => {
      expect({
        status: response.status,
        body: await response.json(),
      }).toEqual({
        status: 503,
        body: expect.objectContaining({
          status: 'fail',
          details: expect.objectContaining({ map: { status: 'fail' } }),
        }),
      })
    })
  })

  describe('and the startup probe is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/health/startup')
    })

    it('should respond with a 503', () => {
      expect(response.status).toBe(503)
    })
  })

  describe('and the liveness probe is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/health/live')
    })

    it('should respond with a 200 and alive', async () => {
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 200,
        body: 'alive',
      })
    })
  })

  describe('and the legacy ready endpoint is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/ready')
    })

    it('should respond with a 503 and Not ready', async () => {
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 503,
        body: 'Not ready',
      })
    })
  })

  describe('and the ping endpoint is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/ping')
    })

    it('should respond with a 200 and ok', async () => {
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 200,
        body: 'ok',
      })
    })
  })
})

describe('when the map is ready', () => {
  let server: TestServer
  let response: Response

  beforeEach(async () => {
    server = await startTestServer({ map: createFixtureMap({ ready: true }) })
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('and the readiness probe is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/health/ready')
    })

    it('should respond with a 200 and every probe passing', async () => {
      expect({
        status: response.status,
        body: await response.json(),
      }).toEqual({
        status: 200,
        body: expect.objectContaining({ status: 'pass' }),
      })
    })
  })

  describe('and the startup probe is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/health/startup')
    })

    it('should respond with a 200', () => {
      expect(response.status).toBe(200)
    })
  })

  describe('and the legacy ready endpoint is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/ready')
    })

    it('should respond with a 200 and ok', async () => {
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 200,
        body: 'ok',
      })
    })
  })
})
