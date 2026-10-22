import { Readable } from 'stream'
import {
  estateMapHandler,
  estateMapPngRequestHandler,
  estateRequestHandler,
  mapPngRequestHandler,
  parcelMapPngRequestHandler,
  parcelRequestHandler,
  tokenRequestHandler,
} from '../../src/controllers/handlers'
import { NFT } from '../../src/modules/api/types'
import { Tile, TileType } from '../../src/modules/map/types'
import {
  createRenderLimiter,
  RenderQueueFullError,
} from '../../src/modules/render-limiter'
import { AppComponents, Context } from '../../src/types'

const LAND_CONTRACT_ADDRESS = '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d'
const CHECKSUMMED_LAND_CONTRACT_ADDRESS =
  '0xF87E31492Faf9A91B02Ee0dEAAd50d51d56D5d4d'
const ESTATE_CONTRACT_ADDRESS = '0x959e104e1a4db6317fa58f8295f586e1a978c297'

type PngComponents = Pick<
  AppComponents,
  'image' | 'map' | 'metrics' | 'renderLimiter'
>

function buildTile(x: number, y: number, estateId?: string): Tile {
  return {
    id: `${x},${y}`,
    x,
    y,
    type: TileType.OWNED,
    top: false,
    left: false,
    topLeft: false,
    updatedAt: 1,
    estateId,
  }
}

function buildNft(id: string): NFT {
  return {
    id,
    name: 'A token',
    description: '',
    image: '',
    external_url: '',
    background_color: '000000',
    attributes: [],
  }
}

describe('when handling the map image requests', () => {
  let components: PngComponents
  let isReady: jest.Mock
  let getTiles: jest.Mock
  let getStream: jest.Mock
  let startTimer: jest.Mock
  let endTimer: jest.Mock
  let renderLimiterRun: jest.Mock
  let png: Buffer

  beforeEach(() => {
    png = Buffer.from('a png')
    isReady = jest.fn().mockReturnValue(true)
    getTiles = jest.fn().mockResolvedValue({})
    getStream = jest.fn(async () => Readable.from([png]))
    endTimer = jest.fn()
    startTimer = jest.fn().mockReturnValue({ end: endTimer })
    const renderLimiter = createRenderLimiter({
      maxConcurrent: 1,
      maxQueued: 1,
      maxWaitMs: 1000,
    })
    renderLimiterRun = jest.fn((task) => renderLimiter.run(task))
    components = {
      map: { isReady, getTiles } as unknown as AppComponents['map'],
      image: { getStream },
      metrics: { startTimer } as unknown as AppComponents['metrics'],
      renderLimiter: { run: renderLimiterRun },
    }
  })

  describe('and the map image is requested', () => {
    let url: URL
    let response: Awaited<ReturnType<typeof mapPngRequestHandler>>

    describe('and the params are valid', () => {
      beforeEach(async () => {
        url = new URL('http://localhost/v1/map.png?center=10,-10&size=20')
        response = await mapPngRequestHandler({ components, url })
      })

      it('should respond with a 200 and the encoded PNG', () => {
        expect(response).toEqual({
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: png,
        })
      })

      it('should render it through the render limiter', () => {
        expect(renderLimiterRun).toHaveBeenCalledTimes(1)
      })

      it('should time the render with the map render metric', () => {
        expect(startTimer).toHaveBeenCalledWith('dcl_map_render_time')
      })

      it('should end the render timer with a 200 status', () => {
        expect(endTimer).toHaveBeenCalledWith({ status: 200 })
      })
    })

    describe('and the center is not a pair of integers', () => {
      beforeEach(async () => {
        url = new URL('http://localhost/v1/map.png?center=foo')
        response = await mapPngRequestHandler({ components, url })
      })

      it('should respond with a 400 and the validation error', () => {
        expect(response).toEqual({
          status: 400,
          body: { ok: false, error: 'Invalid center: expected "x,y"' },
        })
      })

      it('should not render the image', () => {
        expect(getStream).not.toHaveBeenCalled()
      })

      it('should end the render timer with a 400 status', () => {
        expect(endTimer).toHaveBeenCalledWith({ status: 400 })
      })
    })

    describe('and the image exceeds the render budget', () => {
      beforeEach(async () => {
        url = new URL('http://localhost/v1/map.png?width=4096&height=4096')
        response = await mapPngRequestHandler({ components, url })
      })

      it('should respond with a 400 explaining the limit', () => {
        expect(response).toEqual({
          status: 400,
          body: {
            ok: false,
            error:
              'Image too large: width * height must be at most 4194304 pixels',
          },
        })
      })
    })

    describe('and the map is not ready', () => {
      beforeEach(async () => {
        isReady.mockReturnValueOnce(false)
        url = new URL('http://localhost/v1/map.png')
        response = await mapPngRequestHandler({ components, url })
      })

      it('should respond with a 503', () => {
        expect(response).toEqual({ status: 503, body: 'Not ready' })
      })

      it('should end the render timer with a 503 status', () => {
        expect(endTimer).toHaveBeenCalledWith({ status: 503 })
      })
    })

    describe('and the render queue is full', () => {
      beforeEach(async () => {
        renderLimiterRun.mockRejectedValueOnce(new RenderQueueFullError())
        url = new URL('http://localhost/v1/map.png')
        response = await mapPngRequestHandler({ components, url })
      })

      it('should respond with a non cacheable 503 that asks to retry later', () => {
        expect(response).toEqual({
          status: 503,
          headers: { 'retry-after': '5', 'cache-control': 'no-store' },
          body: { ok: false, error: 'Too many map renders queued' },
        })
      })

      it('should end the render timer with a 503 status', () => {
        expect(endTimer).toHaveBeenCalledWith({ status: 503 })
      })
    })

    describe('and the render fails', () => {
      beforeEach(async () => {
        getStream.mockRejectedValueOnce(new Error('Canvas failure'))
        url = new URL('http://localhost/v1/map.png')
        response = await mapPngRequestHandler({ components, url })
      })

      it('should respond with a 500 and the error', () => {
        expect(response).toEqual({
          status: 500,
          body: { ok: false, error: 'Canvas failure' },
        })
      })

      it('should end the render timer with a 500 status', () => {
        expect(endTimer).toHaveBeenCalledWith({ status: 500 })
      })
    })
  })

  describe('and the estates minimap is requested', () => {
    let response: Awaited<ReturnType<typeof estateMapHandler>>
    let getEstatesStream: jest.Mock

    beforeEach(async () => {
      getEstatesStream = jest.fn(async () => Readable.from([png]))
      response = await estateMapHandler({
        components: {
          ...components,
          renderEstateMiniMap: { getStream: getEstatesStream },
        },
      } as unknown as Context)
    })

    it('should respond with a 200 and the encoded PNG', () => {
      expect(response).toEqual({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: png,
      })
    })

    it('should end the minimap render timer with a 200 status', () => {
      expect(endTimer).toHaveBeenCalledWith({ status: 200 })
    })
  })

  describe('and a parcel image is requested', () => {
    let params: { x: string; y: string }
    let response: Awaited<ReturnType<typeof parcelMapPngRequestHandler>>

    describe('and the coordinates are integers', () => {
      beforeEach(async () => {
        params = { x: '01', y: '-2' }
        response = await parcelMapPngRequestHandler({
          components,
          params,
          url: new URL('http://localhost/v2/parcels/01/-2/map.png'),
        })
      })

      it('should render the image centered on and selecting the parcel', () => {
        expect(getStream).toHaveBeenCalledWith(
          1024,
          1024,
          20,
          { x: 1, y: -2 },
          [{ x: 1, y: -2 }],
          false,
          false
        )
      })

      it('should time the render with the map render metric', () => {
        expect(startTimer).toHaveBeenCalledWith('dcl_map_render_time')
      })

      it('should end the render timer with a 200 status', () => {
        expect(endTimer).toHaveBeenCalledWith({ status: 200 })
      })
    })

    describe('and a coordinate is not an integer', () => {
      beforeEach(async () => {
        params = { x: 'abc', y: '1' }
        response = await parcelMapPngRequestHandler({
          components,
          params,
          url: new URL('http://localhost/v2/parcels/abc/1/map.png'),
        })
      })

      it('should respond with a 400 and the validation error', () => {
        expect(response).toEqual({
          status: 400,
          body: { ok: false, error: 'Invalid x: expected an integer' },
        })
      })
    })
  })

  describe('and an estate image is requested', () => {
    beforeEach(async () => {
      getTiles.mockResolvedValueOnce(
        Object.fromEntries(
          [-10, -9, 2, 10].map((x) => {
            const tile = buildTile(x, 0, '7')
            return [tile.id, tile]
          })
        )
      )
      await estateMapPngRequestHandler({
        components,
        params: { estateId: '7' },
        url: new URL('http://localhost/v2/estates/7/map.png'),
      })
    })

    it('should center the image on the numeric median of the estate parcels', () => {
      expect(getStream.mock.calls[0][3]).toEqual({ x: 2, y: 0 })
    })

    it('should end the render timer with a 200 status', () => {
      expect(endTimer).toHaveBeenCalledWith({ status: 200 })
    })
  })
})

describe('when handling the metadata requests', () => {
  let map: AppComponents['map']
  let getParcel: jest.Mock
  let getEstate: jest.Mock
  let getDissolvedEstate: jest.Mock
  let getToken: jest.Mock

  beforeEach(() => {
    getParcel = jest.fn().mockResolvedValue(buildNft('parcel'))
    getEstate = jest.fn().mockResolvedValue(null)
    getDissolvedEstate = jest.fn().mockResolvedValue(null)
    getToken = jest.fn().mockResolvedValue(null)
    map = {
      isReady: () => true,
      getParcel,
      getEstate,
      getDissolvedEstate,
      getToken,
    } as unknown as AppComponents['map']
  })

  describe('and a parcel is requested', () => {
    let response: Awaited<ReturnType<typeof parcelRequestHandler>>

    describe('and the coordinates have leading zeros', () => {
      beforeEach(async () => {
        response = await parcelRequestHandler({
          components: { map },
          params: { x: '01', y: '-02' },
        })
      })

      it('should look the parcel up by its normalized coordinates', () => {
        expect(getParcel).toHaveBeenCalledWith(1, -2)
      })

      it('should respond with a 200 and the parcel', () => {
        expect(response).toEqual({ status: 200, body: buildNft('parcel') })
      })
    })

    describe('and a coordinate is not an integer', () => {
      beforeEach(async () => {
        response = await parcelRequestHandler({
          components: { map },
          params: { x: 'abc', y: '1' },
        })
      })

      it('should respond with a 400', () => {
        expect(response).toEqual({ status: 400, body: 'Invalid x or y' })
      })
    })
  })

  describe('and an estate is requested with a non canonical id', () => {
    let response: Awaited<ReturnType<typeof estateRequestHandler>>

    beforeEach(async () => {
      response = await estateRequestHandler({
        components: { map },
        params: { id: '01' },
      })
    })

    it('should respond with a 400', () => {
      expect(response).toEqual({ status: 400, body: 'Invalid id' })
    })

    it('should not look for a dissolved estate', () => {
      expect(getDissolvedEstate).not.toHaveBeenCalled()
    })
  })

  describe('and a token is requested', () => {
    let config: AppComponents['config']
    let response: Awaited<ReturnType<typeof tokenRequestHandler>>

    beforeEach(() => {
      config = {
        requireString: jest.fn(async (name: string) =>
          name === 'LAND_CONTRACT_ADDRESS'
            ? LAND_CONTRACT_ADDRESS
            : ESTATE_CONTRACT_ADDRESS
        ),
      } as unknown as AppComponents['config']
    })

    describe('and the id is not canonical', () => {
      beforeEach(async () => {
        response = await tokenRequestHandler({
          components: { map, config },
          params: { address: ESTATE_CONTRACT_ADDRESS, id: '01' },
        })
      })

      it('should respond with a 404', () => {
        expect(response).toEqual({
          status: 404,
          body: { ok: false, error: 'Not Found' },
        })
      })

      it('should not look for a dissolved estate', () => {
        expect(getDissolvedEstate).not.toHaveBeenCalled()
      })
    })

    describe('and the contract address is checksummed', () => {
      beforeEach(async () => {
        getToken.mockResolvedValueOnce(buildNft('1'))
        response = await tokenRequestHandler({
          components: { map, config },
          params: { address: CHECKSUMMED_LAND_CONTRACT_ADDRESS, id: '1' },
        })
      })

      it('should look the token up by the lowercased address', () => {
        expect(getToken).toHaveBeenCalledWith(LAND_CONTRACT_ADDRESS, '1')
      })

      it('should respond with a 200, the token and the immutable cache header', () => {
        expect(response).toEqual({
          status: 200,
          headers: {
            'cache-control': 'public, max-age=3600,s-maxage=3600, immutable',
          },
          body: buildNft('1'),
        })
      })
    })
  })
})
