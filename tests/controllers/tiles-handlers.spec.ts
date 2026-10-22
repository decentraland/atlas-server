import {
  createLegacyTilesRequestHandler,
  createTilesRequestHandler,
} from '../../src/controllers/handlers'
import { IMapComponent, Tile, TileType } from '../../src/modules/map/types'
import { AppComponents } from '../../src/types'

type TilesResponse = {
  status: number
  headers?: Record<string, string>
  body?: string
}

type TilesHandler = (context: { url: URL }) => Promise<TilesResponse>

const V1_URL = 'https://cdn.example.com/tiles/v1/latest.json'
const V2_URL = 'https://cdn.example.com/tiles/v2/latest.json'

function buildTile(x: number, y: number): Tile {
  return {
    id: `${x},${y}`,
    x,
    y,
    type: TileType.OWNED,
    top: false,
    left: false,
    topLeft: false,
    updatedAt: 1000,
  }
}

describe('when requesting the tiles', () => {
  let map: IMapComponent
  let features: AppComponents['features']
  let tiles: Record<string, Tile>
  let getIsFeatureEnabled: jest.Mock
  let getLastUploadedTilesUrl: jest.Mock
  let getTiles: jest.Mock
  let handler: TilesHandler
  let response: TilesResponse

  beforeEach(() => {
    tiles = { '0,0': buildTile(0, 0), '5,5': buildTile(5, 5) }
    getIsFeatureEnabled = jest.fn()
    getLastUploadedTilesUrl = jest
      .fn()
      .mockReturnValue({ v1: V1_URL, v2: V2_URL })
    getTiles = jest.fn().mockResolvedValue(tiles)
    map = {
      isReady: () => true,
      getTiles,
      getLastUpdatedAt: () => 1000,
      getLastUploadedTilesUrl,
    } as unknown as IMapComponent
    features = {
      getIsFeatureEnabled,
    } as unknown as AppComponents['features']
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and the redirect to S3 is enabled', () => {
    beforeEach(() => {
      getIsFeatureEnabled.mockResolvedValue(true)
      handler = createTilesRequestHandler({ map, features })
    })

    describe('and the request has no filter params', () => {
      beforeEach(async () => {
        response = await handler({ url: new URL('http://localhost/v2/tiles') })
      })

      it('should respond with a temporary redirect to the uploaded v2 tiles', () => {
        expect(response).toEqual({
          status: 302,
          headers: {
            location: V2_URL,
            'cache-control': 'public, max-age=60',
          },
        })
      })
    })

    describe.each([
      ['only some of the coordinates', '?x1=0&y1=0'],
      ['non numeric coordinates', '?x1=a&y1=0&x2=1&y2=1'],
      ['include without valid fields', '?include=junk'],
      ['exclude without valid fields', '?exclude=junk,other'],
      ['unrelated params', '?foo=bar'],
      ['coordinates that cover the whole map', '?x1=-10&y1=-10&x2=10&y2=10'],
    ])('and the request has %s', (_name, search) => {
      beforeEach(async () => {
        response = await handler({
          url: new URL(`http://localhost/v2/tiles${search}`),
        })
      })

      it('should redirect to the uploaded v2 tiles', () => {
        expect(response).toEqual(
          expect.objectContaining({
            status: 302,
            headers: expect.objectContaining({ location: V2_URL }),
          })
        )
      })
    })

    describe('and the request filters the tiles by coordinates', () => {
      beforeEach(async () => {
        response = await handler({
          url: new URL('http://localhost/v2/tiles?x1=0&y1=0&x2=1&y2=1'),
        })
      })

      it('should respond with only the tiles within the coordinates', () => {
        expect(response).toEqual(
          expect.objectContaining({
            status: 200,
            body: JSON.stringify({ ok: true, data: { '0,0': tiles['0,0'] } }),
          })
        )
      })
    })

    describe('and a legacy request selects the fields to include', () => {
      beforeEach(async () => {
        handler = createLegacyTilesRequestHandler({ map, features })
        response = await handler({
          url: new URL('http://localhost/v1/tiles?include=x,junk,y'),
        })
      })

      it('should respond with only the valid included fields', () => {
        expect(response).toEqual(
          expect.objectContaining({
            status: 200,
            body: JSON.stringify({
              ok: true,
              data: { '0,0': { x: 0, y: 0 }, '5,5': { x: 5, y: 5 } },
            }),
          })
        )
      })
    })

    describe('and a legacy request has no filter params', () => {
      beforeEach(async () => {
        handler = createLegacyTilesRequestHandler({ map, features })
        response = await handler({ url: new URL('http://localhost/v1/tiles') })
      })

      it('should redirect to the uploaded v1 tiles', () => {
        expect(response).toEqual(
          expect.objectContaining({
            status: 302,
            headers: expect.objectContaining({ location: V1_URL }),
          })
        )
      })
    })

    describe('and the tiles were served from memory while nothing was uploaded yet', () => {
      beforeEach(async () => {
        getLastUploadedTilesUrl.mockReturnValueOnce({})
        await handler({ url: new URL('http://localhost/v2/tiles') })
        response = await handler({ url: new URL('http://localhost/v2/tiles') })
      })

      it('should redirect once the upload is available', () => {
        expect(response).toEqual(
          expect.objectContaining({
            status: 302,
            headers: expect.objectContaining({ location: V2_URL }),
          })
        )
      })
    })

    describe('and the redirect stops being available after a redirect was served', () => {
      beforeEach(async () => {
        await handler({ url: new URL('http://localhost/v2/tiles') })
        getLastUploadedTilesUrl.mockReturnValue({})
        response = await handler({ url: new URL('http://localhost/v2/tiles') })
      })

      it('should serve the tiles from memory', () => {
        expect(response).toEqual(
          expect.objectContaining({
            status: 200,
            body: JSON.stringify({ ok: true, data: tiles }),
          })
        )
      })
    })
  })

  describe('and the redirect to S3 is disabled', () => {
    beforeEach(() => {
      getIsFeatureEnabled.mockResolvedValue(false)
      handler = createTilesRequestHandler({ map, features })
    })

    describe('and the tiles were served from memory', () => {
      beforeEach(async () => {
        await handler({ url: new URL('http://localhost/v2/tiles') })
      })

      describe('and the redirect gets enabled', () => {
        beforeEach(async () => {
          getIsFeatureEnabled.mockResolvedValue(true)
          response = await handler({
            url: new URL('http://localhost/v2/tiles'),
          })
        })

        it('should redirect to the uploaded v2 tiles', () => {
          expect(response).toEqual(
            expect.objectContaining({
              status: 302,
              headers: expect.objectContaining({ location: V2_URL }),
            })
          )
        })
      })

      describe('and requests with params that do not filter arrive', () => {
        beforeEach(async () => {
          await handler({ url: new URL('http://localhost/v2/tiles?x1=123') })
          await handler({
            url: new URL('http://localhost/v2/tiles?exclude=random'),
          })
        })

        // one read builds the unfiltered response, the other the map bounds
        it('should serve them from the cached unfiltered response', () => {
          expect(getTiles).toHaveBeenCalledTimes(2)
        })
      })

      describe('and the same coordinates arrive in a different order', () => {
        beforeEach(async () => {
          await handler({
            url: new URL('http://localhost/v2/tiles?x1=0&y1=0&x2=1&y2=1'),
          })
          await handler({
            url: new URL('http://localhost/v2/tiles?y2=0&x2=0&y1=1&x1=1'),
          })
        })

        // the unfiltered response, the map bounds and one filtered response
        it('should serve them from the same cached response', () => {
          expect(getTiles).toHaveBeenCalledTimes(3)
        })
      })
    })
  })
})
