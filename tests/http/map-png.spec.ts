import {
  buildTile,
  createFixtureMap,
  FixtureMap,
  startTestServer,
  TestServer,
} from '../harness'
import { TileType } from '../../src/modules/map/types'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

async function readPng(response: Response) {
  const bytes = new Uint8Array(await response.arrayBuffer())
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    signature: Array.from(bytes.subarray(0, 8)),
  }
}

describe('when requesting map images', () => {
  let server: TestServer
  let map: FixtureMap
  let response: Response

  afterEach(async () => {
    await server.stop()
  })

  describe('and the map is not ready', () => {
    beforeEach(async () => {
      map = createFixtureMap({ ready: false })
      server = await startTestServer({ map })
      response = await server.fetch('/v2/map.png?width=100&height=100')
    })

    it('should respond with a 503 and Not ready', async () => {
      expect({ status: response.status, body: await response.text() }).toEqual({
        status: 503,
        body: 'Not ready',
      })
    })
  })

  describe('and the map is ready', () => {
    beforeEach(async () => {
      map = createFixtureMap({
        tiles: [
          buildTile('0,0', { type: TileType.PLAZA }),
          buildTile('1,0', { type: TileType.OWNED, estateId: '7' }),
          buildTile('2,0', { type: TileType.OWNED, estateId: '7', left: true }),
        ],
      })
      server = await startTestServer({ map })
    })

    describe('and a small map image is requested', () => {
      beforeEach(async () => {
        response = await server.fetch(
          '/v2/map.png?width=100&height=100&size=10&center=0,0'
        )
      })

      it('should respond with a 200 and a PNG image', async () => {
        expect(await readPng(response)).toEqual({
          status: 200,
          contentType: 'image/png',
          signature: PNG_SIGNATURE,
        })
      })
    })

    describe('and the image of a parcel is requested', () => {
      beforeEach(async () => {
        response = await server.fetch(
          '/v2/parcels/0/0/map.png?width=100&height=100&size=10'
        )
      })

      it('should respond with a 200 and a PNG image', async () => {
        expect(await readPng(response)).toEqual({
          status: 200,
          contentType: 'image/png',
          signature: PNG_SIGNATURE,
        })
      })
    })

    describe('and the image of an existing estate is requested', () => {
      beforeEach(async () => {
        response = await server.fetch(
          '/v2/estates/7/map.png?width=100&height=100&size=10'
        )
      })

      it('should respond with a 200 and a PNG image', async () => {
        expect(await readPng(response)).toEqual({
          status: 200,
          contentType: 'image/png',
          signature: PNG_SIGNATURE,
        })
      })
    })

    describe('and the image of an estate without parcels is requested', () => {
      beforeEach(async () => {
        response = await server.fetch('/v2/estates/1000/map.png', {
          redirect: 'manual',
        })
      })

      it('should redirect to the dissolved estate image', () => {
        expect({
          status: response.status,
          location: response.headers.get('location'),
        }).toEqual({
          status: 302,
          location: 'https://ui.decentraland.org/dissolved_estate.png',
        })
      })
    })

    describe('and the mini map is requested', () => {
      beforeEach(async () => {
        response = await server.fetch('/v1/minimap.png')
      })

      it('should respond with a 200 and a PNG image', async () => {
        expect(await readPng(response)).toEqual({
          status: 200,
          contentType: 'image/png',
          signature: PNG_SIGNATURE,
        })
      })
    })
  })
})
