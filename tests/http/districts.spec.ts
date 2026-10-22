import { createFixtureMap, startTestServer, TestServer } from '../harness'

describe('when requesting the districts', () => {
  let server: TestServer
  let response: Response

  beforeEach(async () => {
    server = await startTestServer({ map: createFixtureMap() })
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('and every district is listed', () => {
    let districts: unknown[]

    beforeEach(async () => {
      districts = server.components.district.getDistricts()
      response = await server.fetch('/v2/districts')
    })

    it('should respond with a 200 and the districts list', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: { ok: true, data: districts },
      })
    })
  })

  describe('and a district that does not exist is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/districts/not-a-district')
    })

    it('should respond with a 404 and Not found', async () => {
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 404,
        body: 'Not found',
      })
    })
  })

  describe('and the contributions of an address without contributions are requested', () => {
    beforeEach(async () => {
      response = await server.fetch(
        '/v2/addresses/0x0000000000000000000000000000000000000001/contributions'
      )
    })

    it('should respond with a 200 and an empty list', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: { ok: true, data: [] },
      })
    })
  })
})
