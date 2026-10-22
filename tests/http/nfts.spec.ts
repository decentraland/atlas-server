import {
  buildNFT,
  createFixtureMap,
  FixtureMap,
  startTestServer,
  TestServer,
  TEST_ESTATE_CONTRACT_ADDRESS,
  TEST_LAND_CONTRACT_ADDRESS,
} from '../harness'
import { NFT } from '../../src/modules/api/types'

describe('when requesting NFTs by their identifiers', () => {
  let server: TestServer
  let map: FixtureMap
  let parcel: NFT
  let estate: NFT
  let dissolvedEstate: NFT
  let response: Response

  beforeEach(async () => {
    parcel = buildNFT('parcel-1-0')
    estate = buildNFT('estate-7')
    dissolvedEstate = buildNFT('estate-9', { name: 'Dissolved estate' })
    map = createFixtureMap({
      parcels: { '1,0': parcel },
      estates: { '7': estate },
      dissolvedEstates: { '9': dissolvedEstate },
      tokens: {
        [`${TEST_LAND_CONTRACT_ADDRESS}-12`]: parcel,
        [`${TEST_ESTATE_CONTRACT_ADDRESS}-7`]: estate,
      },
    })
    server = await startTestServer({ map })
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('and the parcel exists', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/parcels/1/0')
    })

    it('should respond with a 200 and the parcel', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: parcel,
      })
    })
  })

  describe('and the parcel does not exist', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/parcels/3/3')
    })

    it('should respond with a 404 and a not found error', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 404,
        body: { ok: false, error: 'Not Found' },
      })
    })
  })

  describe('and the estate exists', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/estates/7')
    })

    it('should respond with a 200 and the estate', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: estate,
      })
    })
  })

  describe('and the estate was dissolved', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/estates/9')
    })

    it('should respond with a 200 and the dissolved estate', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: dissolvedEstate,
      })
    })
  })

  describe('and the estate never existed', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/estates/1000')
    })

    it('should respond with a 404 and a not found error', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 404,
        body: { ok: false, error: 'Not Found' },
      })
    })
  })

  describe('and a LAND token that exists is requested', () => {
    beforeEach(async () => {
      response = await server.fetch(
        `/v2/contracts/${TEST_LAND_CONTRACT_ADDRESS}/tokens/12`
      )
    })

    it('should respond with a 200 and the parcel', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: parcel,
      })
    })
  })

  describe('and an estate token that exists is requested', () => {
    beforeEach(async () => {
      response = await server.fetch(
        `/v2/contracts/${TEST_ESTATE_CONTRACT_ADDRESS}/tokens/7`
      )
    })

    it('should respond with a 200 and the estate', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: estate,
      })
    })
  })

  describe('and an estate token that was dissolved is requested', () => {
    beforeEach(async () => {
      response = await server.fetch(
        `/v2/contracts/${TEST_ESTATE_CONTRACT_ADDRESS}/tokens/9`
      )
    })

    it('should respond with a 200 and the dissolved estate', async () => {
      expect({ status: response.status, body: await response.json() }).toEqual({
        status: 200,
        body: dissolvedEstate,
      })
    })
  })

  describe('and a token of another contract is requested', () => {
    beforeEach(async () => {
      response = await server.fetch('/v2/contracts/0xother/tokens/9')
    })

    it('should respond with a 404 without looking for dissolved estates', async () => {
      expect({
        status: response.status,
        body: await response.json(),
        dissolvedLookups: map.getDissolvedEstate.mock.calls.length,
      }).toEqual({
        status: 404,
        body: { ok: false, error: 'Not Found' },
        dissolvedLookups: 0,
      })
    })
  })
})
