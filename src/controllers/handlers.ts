import { AppComponents } from '../types'
import { toLegacyTiles } from '../adapters/legacy-tiles'
import { cacheWrapper } from '../logic/cache-wrapper'
import { extractParams, getFilterFromUrl } from '../logic/filter-params'

export const createTilesRequestHandler = (
  components: Pick<AppComponents, 'map'>
) => {
  const { map } = components
  return cacheWrapper(
    async (context: { url: URL }) => {
      if (!map.isReady()) {
        return { status: 503, body: 'Not ready' }
      }
      const tiles = await map.getTiles()
      const data = getFilterFromUrl(context.url, tiles)

      return {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ok: true, data }),
      }
    },
    [map.getLastUpdatedAt]
  )
}

export const createLegacyTilesRequestHandler = (
  components: Pick<AppComponents, 'map'>
) => {
  const { map } = components
  return cacheWrapper(
    async (context: { url: URL }) => {
      if (!map.isReady()) {
        return { status: 503, body: 'Not ready' }
      }
      const tiles = await map.getTiles()
      const data = toLegacyTiles(getFilterFromUrl(context.url, tiles))

      return {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ok: true, data })
      }
    },
    [map.getLastUpdatedAt]
  )
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
    const { width, height, size, center, showOnSale, selected } = extractParams(
      context.url
    )
    const stream = await image.getStream(
      width,
      height,
      size,
      center,
      selected,
      showOnSale
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
      body: { ok: false, error: error.message },
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
    const { width, height, size, showOnSale } = extractParams(context.url)
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
      showOnSale
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
      body: { ok: false, error: error.message },
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
    const { width, height, size, showOnSale } = extractParams(context.url)
    const { estateId } = context.params
    const tiles = await map.getTiles()
    const selected = Object.values(tiles).filter(
      (tile) => tile.estateId && tile.estateId === estateId
    )
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
      showOnSale
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
      body: { ok: false, error: error.message },
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

  const estate = await map.getEstate(id)

  if (estate) {
    return { status: 200, body: estate }
  } else {
    return { status: 404, body: { ok: false, error: 'Not Found' } }
  }
}

export const tokenRequestHandler = async (context: {
  components: Pick<AppComponents, 'map'>
  params: { address: string; id: string }
}) => {
  const { map } = context.components
  const { address, id } = context.params

  if (!map.isReady()) {
    return { status: 503, body: 'Not ready' }
  }

  const token = await map.getToken(address, id)

  if (token) {
    return { status: 200, body: token }
  } else {
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
    return { status: 503, body: 'Not ready' }
  }

  const lastUpdatedAt = map.getLastUpdatedAt()
  return {
    status: 200,
    body: { lastUpdatedAt },
  }
}
