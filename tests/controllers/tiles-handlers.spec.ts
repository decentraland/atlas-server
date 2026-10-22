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

describe('when requesting the tiles', () => {
  let map: IMapComponent
  let features: AppComponents['features']
  let tiles: Record<string, Tile>
  let getIsFeatureEnabled: jest.Mock
  let getLastUploadedTilesUrl: jest.Mock
  let response: TilesResponse

  beforeEach(() => {
    tiles = {
      '0,0': {
        id: '0,0',
        x: 0,
        y: 0,
        type: TileType.OWNED,
        top: false,
        left: false,
        topLeft: false,
        updatedAt: 1000,
      },
      '5,5': {
        id: '5,5',
        x: 5,
        y: 5,
        type: TileType.OWNED,
        top: false,
        left: false,
        topLeft: false,
        updatedAt: 1000,
      },
    }
    getIsFeatureEnabled = jest.fn()
    getLastUploadedTilesUrl = jest.fn().mockReturnValue({
      v1: 'https://cdn.example.com/tiles/v1/latest.json',
      v2: 'https://cdn.example.com/tiles/v2/latest.json',
    })
    map = {
      isReady: () => true,
      getTiles: jest.fn().mockResolvedValue(tiles),
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
    })

    describe('and the request has no filter params', () => {
      beforeEach(async () => {
        const handler = createTilesRequestHandler({ map, features })
        response = await handler({
          url: new URL('http://localhost/v2/tiles'),
        })
      })

      it('should redirect to the uploaded v2 tiles', () => {
        expect(response).toEqual(
          expect.objectContaining({
            status: 301,
            headers: expect.objectContaining({
              location: 'https://cdn.example.com/tiles/v2/latest.json',
            }),
          })
        )
      })
    })

    describe('and the request filters the tiles by coordinates', () => {
      beforeEach(async () => {
        const handler = createTilesRequestHandler({ map, features })
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
        const handler = createLegacyTilesRequestHandler({ map, features })
        response = await handler({
          url: new URL('http://localhost/v1/tiles?include=x,y'),
        })
      })

      it('should respond with only the included fields', () => {
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

    describe('and the redirect stops being available after a redirect was served', () => {
      beforeEach(async () => {
        const handler = createTilesRequestHandler({ map, features })
        await handler({ url: new URL('http://localhost/v2/tiles') })
        getLastUploadedTilesUrl.mockReturnValue({})
        response = await handler({
          url: new URL('http://localhost/v2/tiles'),
        })
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
})
