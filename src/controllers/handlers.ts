import { toLegacyTiles } from '../adapters/legacy-tiles'
import { cacheWrapper } from '../logic/cache-wrapper'
import { IHttpServerComponent } from '@dcl/core-commons'
import {
  extractParams,
  getFilterFromUrl,
  parseCoordinate,
} from '../logic/filter-params'
import { InvalidRequestError, isErrorWithMessage } from '../logic/error'
import { getMapBounds, getTilesFilter, MapBounds } from '../logic/tiles-request'
import { Tile } from '../modules/map/types'
import {
  RenderAbortedError,
  RenderBusyError,
  RenderJob,
  RenderKind,
} from '../adapters/render-pool'
import { AppComponents } from '../types'
import { ApplicationName, Feature } from '../modules/features/types'

type TilesResponse = {
  status: number
  headers?: Record<string, string>
  body?: string
}

function createTilesHandler(
  components: Pick<AppComponents, 'map' | 'features'>,
  version: 'v1' | 'v2',
  toData: (tiles: Record<string, Partial<Tile>>) => unknown
) {
  const { map, features } = components
  // only 200s from memory are cached; the redirect is decided on every request
  const serveFromMemory = cacheWrapper(
    async (context: { url: URL }): Promise<TilesResponse> => {
      const tiles = await map.getTiles()
      const data = toData(getFilterFromUrl(context.url, tiles))
      return {
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ok: true, data }),
      }
    },
    [map.getLastUpdatedAt],
    { getKey: (url) => url.search }
  )

  let bounds: { updatedAt: number; value: MapBounds | null } | undefined
  async function getBounds(): Promise<MapBounds | null> {
    const updatedAt = map.getLastUpdatedAt()
    if (bounds?.updatedAt !== updatedAt) {
      bounds = {
        updatedAt,
        value: getMapBounds(Object.values(await map.getTiles())),
      }
    }
    return bounds.value
  }

  return async (context: { url: URL }): Promise<TilesResponse> => {
    if (!map.isReady()) {
      return { status: 503, body: 'Not ready' }
    }

    const filter = getTilesFilter(context.url, await getBounds())
    // the uploaded files hold every tile, so filtered requests are served from memory
    if (
      !filter.isFiltered &&
      (await features.getIsFeatureEnabled(
        ApplicationName.DAPPS,
        Feature.ATLAS_REDIRECT_TO_S3
      ))
    ) {
      const location = map.getLastUploadedTilesUrl()[version]
      if (location) {
        return {
          status: 302,
          headers: { location, 'cache-control': 'public, max-age=60' },
        }
      }
    }

    return serveFromMemory({ url: filter.url })
  }
}

export const createTilesRequestHandler = (
  components: Pick<AppComponents, 'map' | 'features'>
) => createTilesHandler(components, 'v2', (tiles) => tiles)

export const createLegacyTilesRequestHandler = (
  components: Pick<AppComponents, 'map' | 'features'>
) => createTilesHandler(components, 'v1', toLegacyTiles)

const RENDER_RETRY_AFTER_SECONDS = '5'
const TOKEN_ID_PATTERN = /^(0|[1-9]\d*)$/

type PngComponents = Pick<AppComponents, 'map' | 'renderPool'>
// aborts a render still waiting for a thread when the client disconnects
type PngRequest = { request: { signal: AbortSignal } }

async function renderPng(
  components: Pick<AppComponents, 'renderPool'>,
  request: PngRequest['request'],
  kind: RenderKind,
  getJob: () => Promise<RenderJob>
): Promise<IHttpServerComponent.IResponse> {
  const png = await components.renderPool.render(kind, getJob, {
    signal: request.signal,
  })
  return {
    status: 200,
    headers: {
      'content-type': 'image/png',
    },
    body: png,
  }
}

function toPngErrorResponse(error: unknown): IHttpServerComponent.IResponse {
  if (error instanceof InvalidRequestError) {
    return { status: 400, body: { ok: false, error: error.message } }
  }
  // an aborted render has no client left to read the response
  if (error instanceof RenderBusyError || error instanceof RenderAbortedError) {
    return {
      status: 503,
      headers: {
        'retry-after': RENDER_RETRY_AFTER_SECONDS,
        'cache-control': 'no-store',
      },
      body: { ok: false, error: error.message },
    }
  }
  return {
    status: 500,
    body: {
      ok: false,
      error: isErrorWithMessage(error) ? error.message : 'Unknown error',
    },
  }
}

async function handlePngRequest(
  components: Pick<AppComponents, 'map'>,
  handle: () => Promise<IHttpServerComponent.IResponse>
): Promise<IHttpServerComponent.IResponse> {
  if (!components.map.isReady()) {
    return { status: 503, body: 'Not ready' }
  }
  try {
    return await handle()
  } catch (error) {
    return toPngErrorResponse(error)
  }
}

export async function miniMapHandler(
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'renderMiniMap'>
  }
) {
  const { components, request } = context
  return handlePngRequest(components, () =>
    renderPng(
      components,
      request,
      'minimap',
      components.renderMiniMap.getRenderJob
    )
  )
}

export async function estateMapHandler(
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'renderEstateMiniMap'>
  }
) {
  const { components, request } = context
  return handlePngRequest(components, () =>
    renderPng(
      components,
      request,
      'estatemap',
      components.renderEstateMiniMap.getRenderJob
    )
  )
}

export const mapPngRequestHandler = async (
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'image'>
    url: URL
  }
) => {
  const { components, request } = context
  const { image } = components
  return handlePngRequest(components, async () => {
    const {
      width,
      height,
      size,
      center,
      showOnSale,
      showListedForRent,
      selected,
    } = extractParams(context.url)
    return renderPng(components, request, 'map', () =>
      image.getRenderJob(
        width,
        height,
        size,
        center,
        selected,
        showOnSale,
        showListedForRent
      )
    )
  })
}

export const parcelMapPngRequestHandler = async (
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'image'>
    params: {
      x: string
      y: string
    }
    url: URL
  }
) => {
  const { components, params, request } = context
  const { image } = components
  return handlePngRequest(components, async () => {
    const center = {
      x: parseCoordinate(params.x, 'x'),
      y: parseCoordinate(params.y, 'y'),
    }
    const { width, height, size, showOnSale, showListedForRent } =
      extractParams(context.url)
    const selected = [center]
    return renderPng(components, request, 'map', () =>
      image.getRenderJob(
        width,
        height,
        size,
        center,
        selected,
        showOnSale,
        showListedForRent
      )
    )
  })
}

export const estateMapPngRequestHandler = async (
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'image'>
    params: { estateId: string }
    url: URL
  }
) => {
  const { components, request } = context
  const { image, map } = components
  return handlePngRequest(components, async () => {
    const { width, height, size, showOnSale, showListedForRent } =
      extractParams(context.url)
    const { estateId } = context.params
    const tiles = await map.getTiles()
    const selected = Object.values(tiles).filter(
      (tile) => tile.estateId && tile.estateId === estateId
    )
    if (selected.length === 0) {
      const headers: Record<string, string> = {
        location: 'https://ui.decentraland.org/dissolved_estate.png',
      }
      return {
        status: 302,
        headers,
      }
    }
    const xs = selected.map((coords) => coords.x).sort((a, b) => a - b)
    const ys = selected.map((coords) => coords.y).sort((a, b) => a - b)
    const x = xs[(xs.length / 2) | 0] || 0
    const y = ys[(ys.length / 2) | 0] || 0
    const center = { x, y }
    return renderPng(components, request, 'map', () =>
      image.getRenderJob(
        width,
        height,
        size,
        center,
        selected,
        showOnSale,
        showListedForRent
      )
    )
  })
}

export const parcelRequestHandler = async (context: {
  components: Pick<AppComponents, 'map'>
  params: { x: string; y: string }
}) => {
  const { map } = context.components
  const { x, y } = context.params

  if (!map.isReady()) {
    return { status: 503, body: 'Not ready' }
  }

  let parsedX: number
  let parsedY: number
  try {
    parsedX = parseCoordinate(x, 'x')
    parsedY = parseCoordinate(y, 'y')
  } catch {
    return { status: 400, body: 'Invalid x or y' }
  }

  const parcel = await map.getParcel(parsedX, parsedY)

  if (parcel) {
    return { status: 200, body: parcel }
  } else {
    return { status: 404, body: { ok: false, error: 'Not Found' } }
  }
}

export const estateRequestHandler = async (context: {
  components: Pick<AppComponents, 'map'>
  params: { id: string }
}) => {
  const { map } = context.components
  const { id } = context.params

  if (!map.isReady()) {
    return { status: 503, body: 'Not ready' }
  }

  if (!TOKEN_ID_PATTERN.test(id)) {
    return { status: 400, body: 'Invalid id' }
  }

  const estate = await map.getEstate(id)

  if (estate) {
    return { status: 200, body: estate }
  } else {
    const dissolvedEstate = await map.getDissolvedEstate(id)
    if (dissolvedEstate) {
      return { status: 200, body: dissolvedEstate }
    } else {
      return { status: 404, body: { ok: false, error: 'Not Found' } }
    }
  }
}

export const tokenRequestHandler = async (context: {
  components: Pick<AppComponents, 'map' | 'config'>
  params: { address: string; id: string }
}) => {
  const { map, config } = context.components
  const { id } = context.params
  const address = context.params.address.toLowerCase()

  if (!map.isReady()) {
    return { status: 503, body: 'Not ready' }
  }

  // a non-canonical id is never a token, and would fail the subgraph query
  if (!TOKEN_ID_PATTERN.test(id)) {
    return { status: 404, body: { ok: false, error: 'Not Found' } }
  }

  const token = await map.getToken(address, id)

  if (token) {
    const headers: Record<string, string> = {}
    const landContractAddress = await config.requireString(
      'LAND_CONTRACT_ADDRESS'
    )

    if (address === landContractAddress.toLowerCase()) {
      headers['cache-control'] = 'public, max-age=3600,s-maxage=3600, immutable'
    }

    return { status: 200, headers, body: token }
  } else {
    const estateContractAddress = await config.requireString(
      'ESTATE_CONTRACT_ADDRESS'
    )

    if (address === estateContractAddress.toLowerCase()) {
      const dissolvedEstate = await map.getDissolvedEstate(id)
      if (dissolvedEstate) {
        return { status: 200, body: dissolvedEstate }
      }
    }
    return { status: 404, body: { ok: false, error: 'Not Found' } }
  }
}

export async function pingRequestHandler() {
  return {
    status: 200,
    body: 'ok',
  }
}

export async function readyRequestHandler(context: {
  components: Pick<AppComponents, 'map'>
}) {
  const { map } = context.components
  if (!map.isReady()) {
    return { status: 503, body: 'Not ready' }
  }
  return {
    status: 200,
    body: 'ok',
  }
}

export async function tilesInfoRequestHandler(context: {
  components: Pick<AppComponents, 'map'>
}) {
  const { map } = context.components
  if (!map.isReady()) {
    return {
      status: 503,
      body: 'Not ready',
      headers: {
        'cache-control': 'no-cache',
      },
    }
  }

  const lastUpdatedAt = map.getLastUpdatedAt()
  return {
    headers: {
      'cache-control': 'no-cache',
    },
    status: 200,
    body: { lastUpdatedAt },
  }
}
