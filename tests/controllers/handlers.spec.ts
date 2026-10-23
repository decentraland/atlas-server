import {
  estateMapHandler,
  estateMapPngRequestHandler,
  miniMapHandler,
  estateRequestHandler,
  mapPngRequestHandler,
  parcelMapPngRequestHandler,
  parcelRequestHandler,
  tokenRequestHandler,
} from '../../src/controllers/handlers'
import { NFT } from '../../src/modules/api/types'
import { Tile, TileType } from '../../src/modules/map/types'
import {
  RenderAbortedError,
  RenderBusyError,
  RenderFailedError,
  RenderJob,
} from '../../src/adapters/render-pool'
import { AppComponents } from '../../src/types'

const LAND_CONTRACT_ADDRESS = '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d'
const CHECKSUMMED_LAND_CONTRACT_ADDRESS =
  '0xF87E31492Faf9A91B02Ee0dEAAd50d51d56D5d4d'
const ESTATE_CONTRACT_ADDRESS = '0x959e104e1a4db6317fa58f8295f586e1a978c297'

type PngComponents = Pick<AppComponents, 'image' | 'map' | 'renderPool'>

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
  let request: { signal: AbortSignal }
  let isReady: jest.Mock
  let getTiles: jest.Mock
  let getRenderJob: jest.Mock
  let render: jest.Mock
  let job: RenderJob
  let png: Buffer

  beforeEach(() => {
    png = Buffer.from('a png')
    job = {
      kind: 'pixels',
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
      compressionLevel: 5,
    }
    request = { signal: new AbortController().signal }
    isReady = jest.fn().mockReturnValue(true)
    getTiles = jest.fn().mockResolvedValue({})
    getRenderJob = jest.fn().mockResolvedValue(job)
    // builds the job like the pool does once a thread is free
    render = jest.fn(
      async (_kind: string, getJob: () => Promise<RenderJob>) => {
        await getJob()
        return png
      }
    )
    components = {
      map: { isReady, getTiles } as unknown as AppComponents['map'],
      image: { getRenderJob },
      renderPool: { render },
    }
  })

  describe('and the map image is requested', () => {
    let url: URL
    let response: Awaited<ReturnType<typeof mapPngRequestHandler>>

    describe('and the params are valid', () => {
      beforeEach(async () => {
        url = new URL(
          'http://localhost/v1/map.png?center=10,-10&size=20&selected=1,2&on-sale=true'
        )
        response = await mapPngRequestHandler({ components, request, url })
      })

      it('should respond with a 200 and the encoded PNG', () => {
        expect(response).toEqual({
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: png,
        })
      })

      it('should build the render job from the params', () => {
        expect(getRenderJob).toHaveBeenCalledWith(
          1024,
          1024,
          20,
          { x: 10, y: -10 },
          [{ x: 1, y: 2 }],
          true,
          false
        )
      })

      it("should render it in the pool, cancelled by the request's signal", () => {
        expect(render).toHaveBeenCalledWith('map', expect.any(Function), {
          signal: request.signal,
        })
      })
    })

    describe('and the center is not a pair of integers', () => {
      beforeEach(async () => {
        url = new URL('http://localhost/v1/map.png?center=foo')
        response = await mapPngRequestHandler({ components, request, url })
      })

      it('should respond with a 400 and the validation error', () => {
        expect(response).toEqual({
          status: 400,
          body: { ok: false, error: 'Invalid center: expected "x,y"' },
        })
      })

      it('should not render the image', () => {
        expect(render).not.toHaveBeenCalled()
      })
    })

    describe('and the image exceeds the render budget', () => {
      beforeEach(async () => {
        url = new URL('http://localhost/v1/map.png?width=4096&height=4096')
        response = await mapPngRequestHandler({ components, request, url })
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
        response = await mapPngRequestHandler({ components, request, url })
      })

      it('should respond with a 503', () => {
        expect(response).toEqual({ status: 503, body: 'Not ready' })
      })

      it('should not render the image', () => {
        expect(render).not.toHaveBeenCalled()
      })
    })

    describe('and the render queue is full', () => {
      beforeEach(async () => {
        render.mockRejectedValueOnce(
          new RenderBusyError('Too many map renders queued')
        )
        url = new URL('http://localhost/v1/map.png')
        response = await mapPngRequestHandler({ components, request, url })
      })

      it('should respond with a non cacheable 503 that asks to retry later', () => {
        expect(response).toEqual({
          status: 503,
          headers: { 'retry-after': '5', 'cache-control': 'no-store' },
          body: { ok: false, error: 'Too many map renders queued' },
        })
      })
    })

    describe('and the request is aborted while the render waits for a thread', () => {
      beforeEach(async () => {
        render.mockRejectedValueOnce(
          new RenderAbortedError('The request was aborted')
        )
        url = new URL('http://localhost/v1/map.png')
        response = await mapPngRequestHandler({ components, request, url })
      })

      it('should respond with a non cacheable 503', () => {
        expect(response).toEqual({
          status: 503,
          headers: { 'retry-after': '5', 'cache-control': 'no-store' },
          body: { ok: false, error: 'The request was aborted' },
        })
      })
    })

    describe('and the worker fails to draw or encode the image', () => {
      beforeEach(async () => {
        render.mockRejectedValueOnce(new RenderFailedError('Canvas failure'))
        url = new URL('http://localhost/v1/map.png')
        response = await mapPngRequestHandler({ components, request, url })
      })

      it('should respond with a 500 and the error', () => {
        expect(response).toEqual({
          status: 500,
          body: { ok: false, error: 'Canvas failure' },
        })
      })
    })

    describe('and the render fails', () => {
      beforeEach(async () => {
        render.mockRejectedValueOnce(new Error('Canvas failure'))
        url = new URL('http://localhost/v1/map.png')
        response = await mapPngRequestHandler({ components, request, url })
      })

      it('should respond with a 500 and the error', () => {
        expect(response).toEqual({
          status: 500,
          body: { ok: false, error: 'Canvas failure' },
        })
      })
    })
  })

  describe.each([
    ['minimap', miniMapHandler],
    ['estatemap', estateMapHandler],
  ])('and the %s is requested', (kind, handler) => {
    let context: Parameters<typeof miniMapHandler>[0] &
      Parameters<typeof estateMapHandler>[0]
    let getMiniMapJob: jest.Mock
    let response: Awaited<ReturnType<typeof handler>>

    beforeEach(() => {
      getMiniMapJob = jest.fn().mockResolvedValue(job)
      context = {
        request,
        components: {
          ...components,
          renderMiniMap: { getRenderJob: getMiniMapJob },
          renderEstateMiniMap: { getRenderJob: getMiniMapJob },
        },
      }
    })

    describe('and a render thread is available', () => {
      beforeEach(async () => {
        response = await handler(context)
      })

      it('should respond with a 200 and the encoded PNG', () => {
        expect(response).toEqual({
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: png,
        })
      })

      it("should render the minimap's job", () => {
        expect(getMiniMapJob).toHaveBeenCalledTimes(1)
      })

      it('should label the render with the image it is for', () => {
        expect(render.mock.calls[0][0]).toBe(kind)
      })
    })

    describe('and the render queue is full', () => {
      beforeEach(async () => {
        render.mockRejectedValueOnce(
          new RenderBusyError('Too many map renders queued')
        )
        response = await handler(context)
      })

      it('should respond with a non cacheable 503 that asks to retry later', () => {
        expect(response).toEqual({
          status: 503,
          headers: { 'retry-after': '5', 'cache-control': 'no-store' },
          body: { ok: false, error: 'Too many map renders queued' },
        })
      })
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
          request,
          params,
          url: new URL('http://localhost/v2/parcels/01/-2/map.png'),
        })
      })

      it('should render the image centered on and selecting the parcel', () => {
        expect(getRenderJob).toHaveBeenCalledWith(
          1024,
          1024,
          20,
          { x: 1, y: -2 },
          [{ x: 1, y: -2 }],
          false,
          false
        )
      })

      it('should respond with a 200 and the encoded PNG', () => {
        expect(response).toEqual({
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: png,
        })
      })
    })

    describe('and a coordinate is not an integer', () => {
      beforeEach(async () => {
        params = { x: 'abc', y: '1' }
        response = await parcelMapPngRequestHandler({
          components,
          request,
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
    let response: Awaited<ReturnType<typeof estateMapPngRequestHandler>>

    describe('and the estate has parcels', () => {
      beforeEach(async () => {
        getTiles.mockResolvedValueOnce(
          Object.fromEntries(
            [-10, -9, 2, 10].map((x) => {
              const tile = buildTile(x, 0, '7')
              return [tile.id, tile]
            })
          )
        )
        response = await estateMapPngRequestHandler({
          components,
          request,
          params: { estateId: '7' },
          url: new URL('http://localhost/v2/estates/7/map.png'),
        })
      })

      it('should center the image on the numeric median of the estate parcels', () => {
        expect(getRenderJob.mock.calls[0][3]).toEqual({ x: 2, y: 0 })
      })

      it('should respond with a 200 and the encoded PNG', () => {
        expect(response).toEqual({
          status: 200,
          headers: { 'content-type': 'image/png' },
          body: png,
        })
      })
    })

    describe('and the estate has no parcels', () => {
      beforeEach(async () => {
        response = await estateMapPngRequestHandler({
          components,
          request,
          params: { estateId: '7' },
          url: new URL('http://localhost/v2/estates/7/map.png'),
        })
      })

      it('should redirect to the dissolved estate image', () => {
        expect(response).toEqual({
          status: 302,
          headers: {
            location: 'https://ui.decentraland.org/dissolved_estate.png',
          },
        })
      })

      it('should not render the image', () => {
        expect(render).not.toHaveBeenCalled()
      })
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
