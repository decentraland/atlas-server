import { IFeaturesComponent } from '@well-known-components/features-component'
import { toLegacyTiles } from '../adapters/legacy-tiles'
import { cacheWrapper } from '../logic/cache-wrapper'
import { extractParams, getFilterFromUrl } from '../logic/filter-params'
import { isErrorWithMessage } from '../logic/error'
import { AppComponents, Context } from '../types'
import { ApplicationName, Feature } from '../modules/features/types'
import { IMapComponent } from '../modules/map/types'

/**
 * Checks if the S3 redirect feature flag is enabled
 */
const isS3RedirectEnabled = async (features: IFeaturesComponent) => {
  return await features.getIsFeatureEnabled(
    ApplicationName.DAPPS,
    Feature.ATLAS_REDIRECT_TO_S3
  )
}

/**
 * Attempts to get a redirect response to the S3-stored tiles
 * @param map - The map component to get the URLs from
 * @param version - Which version of tiles to get ('v1' for legacy, 'v2' for current)
 * @returns A redirect response object if S3 URL is available, null otherwise
 */
const handleGetLastUploadedTilesUrl = (
  map: IMapComponent,
  version: 'v1' | 'v2'
) => {
  const lastUploadedUrls = map.getLastUploadedTilesUrl()
  if (lastUploadedUrls[version]) {
    return {
      status: 301,
      headers: {
        location: lastUploadedUrls[version],
        'cache-control': 'public, max-age=60',
      } as Record<string, string>,
    }
  }
  return null
}

/**
 * Handles the common logic for both tiles handlers
 * @param map - The map component
 * @param features - The features component
 * @param version - Which version of tiles to get ('v1' for legacy, 'v2' for current)
 * @param logger - Optional logger to log warnings
 * @returns Either a response object if should redirect/error, or null if should continue with map tiles
 */
const handleTilesRequest = async (
  map: IMapComponent,
  features: IFeaturesComponent,
  version: 'v1' | 'v2',
  logger?: { warn: (msg: string) => void }
) => {
  const isRedirectToS3Enabled = await isS3RedirectEnabled(features)

  // If map is not ready and feature flag is off -> return 503
  if (!map.isReady() && !isRedirectToS3Enabled) {
    return { status: 503, body: 'Not ready' }
  }

  // If feature flag is on, try to redirect to S3 (regardless of map ready state)
  // This ensures we serve from S3 when:
  // 1. Map is not ready but we have a cached version in S3
  // 2. Map is ready but we want to reduce load on the service
  if (isRedirectToS3Enabled) {
    const redirectResponse = handleGetLastUploadedTilesUrl(map, version)
    if (redirectResponse) {
      return redirectResponse
    }
    logger?.warn('No S3 file available')
  }

  // If we reach here, it means either:
  // - Feature flag is on but no S3 file is available
  // - Feature flag is off and map should be ready (checked in first condition)
  if (!map.isReady()) {
    logger?.warn('Map is not ready')
    return { status: 503, body: 'Not ready' }
  }

  return null
}

export const createTilesRequestHandler = (
  components: Pick<AppComponents, 'map' | 'features' | 'logs'>
) => {
  const { map, features, logs } = components
  const componentLogger = logs.getLogger('tiles-request-handler')
  return cacheWrapper(
    async (context: { url: URL }) => {
      const response = await handleTilesRequest(
        map,
        features,
        'v2',
        componentLogger
      )
      if (response) {
        return response
      }

      // Serve tiles directly from the map
      const tiles = await map.getTiles()
      const data = getFilterFromUrl(context.url, tiles)
      return {
        status: 200,
        headers: {
          'content-type': 'application/json',
        } as Record<string, string>,
        body: JSON.stringify({ ok: true, data }),
      }
    },
    [map.getLastUpdatedAt]
  )
}

export const createLegacyTilesRequestHandler = (
  components: Pick<AppComponents, 'map' | 'features' | 'logs'>
) => {
  const { map, features, logs } = components
  const componentLogger = logs.getLogger('legacy-tiles-request-handler')
  return cacheWrapper(
    async (context: { url: URL }) => {
      const response = await handleTilesRequest(
        map,
        features,
        'v1',
        componentLogger
      )
      if (response) {
        return response
      }

      // Serve tiles directly from the map
      const tiles = await map.getTiles()
      const data = toLegacyTiles(getFilterFromUrl(context.url, tiles))
      return {
        status: 200,
        headers: {
          'content-type': 'application/json',
        } as Record<string, string>,
        body: JSON.stringify({ ok: true, data }),
      }
    },
    [map.getLastUpdatedAt]
  )
}

export async function miniMapHandler(context: Context) {
  const { renderMiniMap, map, metrics } = context.components
  const timer = metrics.startTimer('dcl_mini_map_render_time')
  try {
    if (!map.isReady()) {
      return { status: 503, body: 'Not ready' }
    }
    const stream = await renderMiniMap.getStream()
    timer.end({ status: 200 })
    return {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
      body: stream,
    }
  } catch (error) {
    timer.end({ status: 500 })
    return {
      status: 500,
      body: {
        ok: false,
        error: isErrorWithMessage(error) ? error.message : 'Unknown error',
      },
    }
  }
}

export async function estateMapHandler(context: Context) {
  const { renderEstateMiniMap, map, metrics } = context.components
  const timer = metrics.startTimer('dcl_mini_map_render_time')
  try {
    if (!map.isReady()) {
      return { status: 503, body: 'Not ready' }
    }
    const stream = await renderEstateMiniMap.getStream()
    timer.end({ status: 200 })
    return {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
      body: stream,
    }
  } catch (error) {
    timer.end({ status: 500 })
    return {
      status: 500,
      body: {
        ok: false,
        error: isErrorWithMessage(error) ? error.message : 'Unknown error',
      },
    }
  }
}

export const mapPngRequestHandler = async (context: {
  components: Pick<AppComponents, 'image' | 'map' | 'metrics'>
  url: URL
}) => {
  const { image, map, metrics } = context.components
  const timer = metrics.startTimer('dcl_map_render_time')
  try {
    if (!map.isReady()) {
      return { status: 503, body: 'Not ready' }
    }
    const {
      width,
      height,
      size,
      center,
      showOnSale,
      showListedForRent,
      selected,
    } = extractParams(context.url)
    const stream = await image.getStream(
      width,
      height,
      size,
      center,
      selected,
      showOnSale,
      showListedForRent
    )
    timer.end({ status: 200 })
    return {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
      body: stream,
    }
  } catch (error) {
    timer.end({ status: 500 })
    return {
      status: 500,
      body: {
        ok: false,
        error: isErrorWithMessage(error) ? error.message : 'Unknown error',
      },
    }
  }
}

export const parcelMapPngRequestHandler = async (context: {
  components: Pick<AppComponents, 'image' | 'map'>
  params: {
    x: string
    y: string
  }
  url: URL
}) => {
  const { components, params } = context
  const { image, map } = components
  try {
    if (!map.isReady()) {
      return { status: 503, body: 'Not ready' }
    }
    const { width, height, size, showOnSale, showListedForRent } =
      extractParams(context.url)
    const center = {
      x: parseInt(params.x) || 0,
      y: parseInt(params.y) || 0,
    }
    const selected = [center]
    const stream = await image.getStream(
      width,
      height,
      size,
      center,
      selected,
      showOnSale,
      showListedForRent
    )
    return {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
      body: stream,
    }
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        error: isErrorWithMessage(error) ? error.message : 'Unknown error',
      },
    }
  }
}

export const estateMapPngRequestHandler = async (context: {
  components: Pick<AppComponents, 'image' | 'map'>
  params: { estateId: string }
  url: URL
}) => {
  const { image, map } = context.components
  try {
    if (!map.isReady()) {
      return { status: 503, body: 'Not ready' }
    }
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
    const xs = selected.map((coords) => coords.x).sort()
    const ys = selected.map((coords) => coords.y).sort()
    const x = xs[(xs.length / 2) | 0] || 0
    const y = ys[(ys.length / 2) | 0] || 0
    const center = { x, y }
    const stream = await image.getStream(
      width,
      height,
      size,
      center,
      selected,
      showOnSale,
      showListedForRent
    )
    return {
      status: 200,
      headers: {
        'content-type': 'image/png',
      },
      body: stream,
    }
  } catch (error) {
    return {
      status: 500,
      body: {
        ok: false,
        error: isErrorWithMessage(error) ? error.message : 'Unknown error',
      },
    }
  }
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

  const parsedCoords = [parseInt(x), parseInt(y)]
  if (isNaN(parsedCoords[0]) || isNaN(parsedCoords[1])) {
    return { status: 403, body: 'Invalid x or y' }
  }

  const parcel = await map.getParcel(x, y)

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

  const parsedId = parseInt(id)
  if (isNaN(parsedId)) {
    return { status: 403, body: 'Invalid id' }
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
  const { address, id } = context.params

  if (!map.isReady()) {
    return { status: 503, body: 'Not ready' }
  }

  const token = await map.getToken(address, id)

  if (token) {
    const headers: Record<string, string> = {}
    const landContractAddress = await config.requireString(
      'LAND_CONTRACT_ADDRESS'
    )

    if (address === landContractAddress) {
      headers['cache-control'] = 'public, max-age=3600,s-maxage=3600, immutable'
    }

    return { status: 200, headers, body: token }
  } else {
    const estateContractAddress = await config.requireString(
      'ESTATE_CONTRACT_ADDRESS'
    )

    if (address === estateContractAddress) {
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
