import {
  buildTile,
  createFixtureMap,
  FixtureMap,
  startTestServer,
  TestServer,
} from '../harness'
import { Tile, TileType } from '../../src/modules/map/types'

describe('when requesting the tiles', () => {
  let server: TestServer
  let map: FixtureMap
  let tiles: Tile[]
  let response: Response

  beforeEach(() => {
    tiles = [
      buildTile('-1,0', { type: TileType.ROAD, name: 'Road' }),
      buildTile('0,0', { type: TileType.PLAZA, name: 'Genesis Plaza' }),
      buildTile('1,0', {
        type: TileType.OWNED,
        owner: '0xowner',
        estateId: '7',
        tokenId: '340282366920938463463374607431768211456',
        name: 'An estate',
        left: true,
      }),
      buildTile('2,0', { type: TileType.UNOWNED }),
      buildTile('5,5', { type: TileType.DISTRICT, name: 'A district' }),
    ]
  })

  afterEach(async () => {
    await server.stop()
  })

  describe('and the map is not ready', () => {
    beforeEach(async () => {
      map = createFixtureMap({ tiles, ready: false })
      server = await startTestServer({ map })
    })

    describe('and the v2 tiles are requested', () => {
      beforeEach(async () => {
        response = await server.fetch('/v2/tiles')
      })

      it('should respond with a 503 and Not ready', async () => {
        expect({
          status: response.status,
          body: await response.text(),
        }).toEqual({ status: 503, body: 'Not ready' })
      })
    })

    describe('and the tiles info is requested', () => {
      beforeEach(async () => {
        response = await server.fetch('/v2/tiles/info')
      })

      it('should respond with a 503 that is not cached', () => {
        expect({
          status: response.status,
          cacheControl: response.headers.get('cache-control'),
        }).toEqual({ status: 503, cacheControl: 'no-cache' })
      })
    })
  })

  describe('and the map is ready', () => {
    let lastUpdatedAt: number

    beforeEach(async () => {
      lastUpdatedAt = Date.UTC(2026, 0, 1)
      map = createFixtureMap({ tiles, lastUpdatedAt })
      server = await startTestServer({ map })
    })

    describe('and the tiles info is requested', () => {
      beforeEach(async () => {
        response = await server.fetch('/v2/tiles/info')
      })

      it('should respond with a 200 and the last update time, not cached', async () => {
        expect({
          status: response.status,
          cacheControl: response.headers.get('cache-control'),
          body: await response.json(),
        }).toEqual({
          status: 200,
          cacheControl: 'no-cache',
          body: { lastUpdatedAt },
        })
      })
    })

    describe('and the v2 tiles are requested without filters', () => {
      beforeEach(async () => {
        response = await server.fetch('/v2/tiles')
      })

      it('should respond with a 200 and every tile keyed by its id as JSON', async () => {
        expect({
          status: response.status,
          contentType: response.headers.get('content-type'),
          body: await response.json(),
        }).toEqual({
          status: 200,
          contentType: 'application/json',
          body: {
            ok: true,
            data: Object.fromEntries(tiles.map((tile) => [tile.id, tile])),
          },
        })
      })
    })

    describe('and the v2 tiles are requested for an area', () => {
      beforeEach(async () => {
        response = await server.fetch('/v2/tiles?x1=0&y1=0&x2=2&y2=0')
      })

      it('should respond with only the tiles inside the area', async () => {
        expect(Object.keys((await response.json()).data).sort()).toEqual([
          '0,0',
          '1,0',
          '2,0',
        ])
      })
    })

    describe('and the v2 tiles are requested including some fields', () => {
      beforeEach(async () => {
        response = await server.fetch('/v2/tiles?include=x,y,type')
      })

      it('should respond with every tile reduced to the included fields', async () => {
        expect((await response.json()).data['1,0']).toEqual({
          x: 1,
          y: 0,
          type: TileType.OWNED,
        })
      })
    })

    describe('and the v1 tiles are requested without filters', () => {
      beforeEach(async () => {
        response = await server.fetch('/v1/tiles')
      })

      it('should respond with a 200 and the tiles in the legacy format', async () => {
        expect({
          status: response.status,
          body: await response.json(),
        }).toEqual({
          status: 200,
          body: {
            ok: true,
            data: {
              '-1,0': { type: 7, x: -1, y: 0, name: 'Road' },
              '0,0': { type: 8, x: 0, y: 0, name: 'Genesis Plaza' },
              '1,0': {
                type: 9,
                x: 1,
                y: 0,
                owner: '0xowner',
                estate_id: '7',
                name: 'An estate',
                left: 1,
              },
              '2,0': { type: 11, x: 2, y: 0 },
              '5,5': { type: 5, x: 5, y: 5, name: 'A district' },
            },
          },
        })
      })
    })

    describe('and the redirect to S3 is disabled', () => {
      beforeEach(async () => {
        response = await server.fetch('/v2/tiles')
      })

      it('should ask the features component for the redirect flag of the dapps', () => {
        expect(server.stubs.features.getIsFeatureEnabled).toHaveBeenCalledWith(
          'dapps',
          'atlas-redirect-to-s3'
        )
      })
    })
  })
})
