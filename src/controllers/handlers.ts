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
import { MapSnapshot, Tile } from '../modules/map/types'
import { RenderAbortedError, RenderBusyError } from '../adapters/render-pool'
import { ImageKind, ImageVersionScope } from '../adapters/image-cache'
import {
  getImageCacheHeaders,
  isNotModified,
  REDIRECT_CACHE_CONTROL,
} from '../logic/image-http-cache'
import { getEstateTiles } from '../logic/estate-tiles'
import { getViewport } from '../modules/render'
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
const DISSOLVED_ESTATE_IMAGE_URL =
  'https://ui.decentraland.org/dissolved_estate.png'

class DissolvedEstateError extends Error {
  constructor(estateId: string) {
    super(`Estate ${estateId} has no parcels`)
    this.name = 'DissolvedEstateError'
  }
}

type PngComponents = Pick<AppComponents, 'map' | 'renderPool' | 'imageCache'>
// aborts a render still waiting for a thread when the client disconnects
type PngRequest = {
  request: { signal: AbortSignal; headers: Pick<Headers, 'get'> }
  url: URL
}
/** An image to serve: its route, its normalized params and how to render it on a miss. */
type PngSource = {
  kind: ImageKind
  key: string
  /** draws prices or rentals, so it follows the overlay version rather than the land version */
  overlays: boolean
  render: (signal: AbortSignal) => Promise<Buffer>
}

type MapImageParams = ReturnType<typeof extractParams>

// the params every map image is drawn with; they are already clamped
function getImageParamsKey(params: MapImageParams): string {
  return [
    `${params.width}x${params.height}`,
    params.size,
    params.showOnSale ? 1 : 0,
    params.showListedForRent ? 1 : 0,
  ].join('|')
}

// the renderer only reads the tiles inside the viewport, so a selection outside it changes nothing
function clipSelection(params: MapImageParams): MapImageParams {
  const { width, height, size, center } = params
  const { nw, se } = getViewport({ width, height, center, size, padding: 1 })
  const ids = new Set<string>()
  const selected = params.selected.filter(({ x, y }) => {
    const id = `${x},${y}`
    if (x < nw.x || x >= se.x || y < se.y || y >= nw.y || ids.has(id)) {
      return false
    }
    ids.add(id)
    return true
  })
  return { ...params, selected }
}

// equal keys must render equal images: the selection is a set, clipped to the viewport
function getMapImageKey(params: MapImageParams): string {
  const { center, selected } = params
  const selection = selected.map(({ x, y }) => `${x},${y}`).sort()
  return [
    getImageParamsKey(params),
    `${center.x},${center.y}`,
    selection.join(';'),
  ].join('|')
}

function hasOverlays(params: MapImageParams): boolean {
  return params.showOnSale || params.showListedForRent
}

function renderMapImage(
  components: Pick<AppComponents, 'image' | 'renderPool'>,
  snapshot: MapSnapshot,
  params: MapImageParams,
  signal: AbortSignal
): Promise<Buffer> {
  const { width, height, size, center, selected, showOnSale } = params
  return components.renderPool.render(
    'map',
    () =>
      components.image.getRenderJob(
        snapshot.tiles,
        width,
        height,
        size,
        center,
        selected,
        showOnSale,
        params.showListedForRent
      ),
    { signal }
  )
}

function toPngErrorResponse(error: unknown): IHttpServerComponent.IResponse {
  if (error instanceof InvalidRequestError) {
    return { status: 400, body: { ok: false, error: error.message } }
  }
  if (error instanceof DissolvedEstateError) {
    return {
      status: 302,
      headers: {
        location: DISSOLVED_ESTATE_IMAGE_URL,
        'cache-control': REDIRECT_CACHE_CONTROL,
      },
    }
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

// both versions are fingerprints of the data, the same on every replica
function getImageVersion(
  snapshot: MapSnapshot,
  overlays: boolean
): { scope: ImageVersionScope; version: string } {
  return overlays
    ? { scope: 'overlay', version: snapshot.overlayVersion }
    : { scope: 'land', version: snapshot.landVersion }
}

/**
 * Serves a map image: answers conditional requests before anything is rendered, then serves the
 * PNG from the image cache, rendering it once on a miss. The map snapshot is taken once, before
 * anything awaits, and both the version and the render read from it, so an image always matches
 * its ETag even when the map refreshes while the render waits for a thread.
 */
async function handlePngRequest(
  context: PngRequest & {
    components: Pick<AppComponents, 'map' | 'imageCache'>
  },
  getSource: (snapshot: MapSnapshot) => PngSource
): Promise<IHttpServerComponent.IResponse> {
  const { components, request, url } = context
  const { map, imageCache } = components
  if (!map.isReady()) {
    return { status: 503, body: 'Not ready' }
  }
  try {
    const snapshot = map.getSnapshot()
    const { kind, key, overlays, render } = getSource(snapshot)
    const { scope, version } = getImageVersion(snapshot, overlays)
    const headers = getImageCacheHeaders(version, `${kind}|${key}`, url)
    if (isNotModified(request.headers, headers.etag)) {
      imageCache.record(kind, 'not_modified')
      return { status: 304, headers: { ...headers } }
    }
    const png = await imageCache.getOrRender(
      { kind, key, scope, version, signal: request.signal },
      render
    )
    return {
      status: 200,
      headers: { ...headers, 'content-type': 'image/png' },
      body: png,
    }
  } catch (error) {
    return toPngErrorResponse(error)
  }
}

export async function miniMapHandler(
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'renderMiniMap'>
  }
) {
  const { renderPool, renderMiniMap } = context.components
  return handlePngRequest(context, ({ tiles }) => ({
    kind: 'minimap',
    key: '',
    overlays: false,
    render: (signal) =>
      renderPool.render('minimap', () => renderMiniMap.getRenderJob(tiles), {
        signal,
      }),
  }))
}

export async function estateMapHandler(
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'renderEstateMiniMap'>
  }
) {
  const { renderPool, renderEstateMiniMap } = context.components
  return handlePngRequest(context, ({ tiles }) => ({
    kind: 'estatemap',
    key: '',
    overlays: false,
    render: (signal) =>
      renderPool.render(
        'estatemap',
        () => renderEstateMiniMap.getRenderJob(tiles),
        { signal }
      ),
  }))
}

export const mapPngRequestHandler = async (
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'image'>
  }
) => {
  const { components } = context
  return handlePngRequest(context, (snapshot) => {
    const params = clipSelection(extractParams(context.url))
    return {
      kind: 'map',
      key: getMapImageKey(params),
      overlays: hasOverlays(params),
      render: (signal) => renderMapImage(components, snapshot, params, signal),
    }
  })
}

export const parcelMapPngRequestHandler = async (
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'image'>
    params: {
      x: string
      y: string
    }
  }
) => {
  const { components, params } = context
  return handlePngRequest(context, (snapshot) => {
    const center = {
      x: parseCoordinate(params.x, 'x'),
      y: parseCoordinate(params.y, 'y'),
    }
    const imageParams = {
      ...extractParams(context.url),
      center,
      selected: [center],
    }
    return {
      kind: 'parcel',
      key: getMapImageKey(imageParams),
      overlays: hasOverlays(imageParams),
      render: (signal) =>
        renderMapImage(components, snapshot, imageParams, signal),
    }
  })
}

export const estateMapPngRequestHandler = async (
  context: PngRequest & {
    components: PngComponents & Pick<AppComponents, 'image'>
    params: { estateId: string }
  }
) => {
  const { components } = context
  const { imageCache } = components
  const { estateId } = context.params
  return handlePngRequest(context, (snapshot) => {
    const params = extractParams(context.url)
    const selected = getEstateTiles(snapshot.tiles, estateId)
    if (selected.length === 0) {
      imageCache.record('estate', 'dissolved')
      throw new DissolvedEstateError(estateId)
    }
    return {
      kind: 'estate',
      // the center and selection come from the estate, not the query
      key: [estateId, getImageParamsKey(params)].join('|'),
      overlays: hasOverlays(params),
      render: (signal) => {
        const xs = selected.map((coords) => coords.x).sort((a, b) => a - b)
        const ys = selected.map((coords) => coords.y).sort((a, b) => a - b)
        const x = xs[(xs.length / 2) | 0] || 0
        const y = ys[(ys.length / 2) | 0] || 0
        return renderMapImage(
          components,
          snapshot,
          { ...params, center: { x, y }, selected },
          signal
        )
      },
    }
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
    body: {
      lastUpdatedAt,
      landVersion: map.getLandVersion(),
      overlayVersion: map.getOverlayVersion(),
    },
  }
}
