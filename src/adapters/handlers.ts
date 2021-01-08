import { IHttpServerComponent as http } from '@well-known-components/interfaces'
import { extractQueryParams, filterTiles, toLegacyTiles } from '../logic/tiles'
import { AppComponents } from '../types'
import { cacheWrapper } from '../logic/cache'
import { getStream } from '../logic/image-helpers'

export const createTilesRequestHandler = (
  components: Pick<AppComponents, 'map'>
) => {
  const { map } = components
  return cacheWrapper(
    async (ctx) => {
      const tiles = await map.getTiles()
      return {
        status: 200,
        body: filterTiles(ctx.query, tiles),
      }
    },
    [map.getLastUpdatedAt]
  )
}

export const createLegacyTilesRequestHandler = (
  components: Pick<AppComponents, 'server' | 'map'>
) => {
  const { map } = components
  return cacheWrapper(
    async (ctx) => {
      const tiles = await map.getTiles()
      return {
        status: 200,
        body: toLegacyTiles(filterTiles(ctx.query, tiles)),
      }
    },
    [map.getLastUpdatedAt]
  )
}

export async function mapPngRequestHandler(ctx: {
  components: Pick<AppComponents, 'map'>
  query: http.QueryParams
}) {
  const { map } = ctx.components
  const {
    width,
    height,
    size,
    center,
    showOnSale,
    selected,
  } = extractQueryParams(ctx.query)
  const stream = await getStream(
    map,
    width,
    height,
    size,
    center,
    selected,
    showOnSale
  )
  return {
    status: 200,
    body: stream,
    headers: {
      'content-type': 'image/png',
    },
  }
}

export async function parcelMapPngRequestHandler(ctx: {
  components: Pick<AppComponents, 'map'>
  query: http.QueryParams
  params: {
    x: string
    y: string
  }
}) {
  const { map } = ctx.components
  const { width, height, size, showOnSale } = extractQueryParams(ctx.query)
  const center = {
    x: parseInt(ctx.params.x) || 0,
    y: parseInt(ctx.params.y) || 0,
  }
  const selected = [center]
  const stream = await getStream(
    map,
    width,
    height,
    size,
    center,
    selected,
    showOnSale
  )
  return {
    status: 200,
    body: stream,
    headers: {
      'content-type': 'image/png',
    },
  }
}

export async function estateMapPngRequestHandler(ctx: {
  components: Pick<AppComponents, 'map'>
  params: { id: string }
  query: http.QueryParams
}) {
  const { map } = ctx.components
  const { width, height, size, showOnSale } = extractQueryParams(ctx.query)
  const estateId = ctx.params.id
  const tiles = await map.getTiles()
  const selected = Object.values(tiles).filter(
    (tile) => tile.estateId && tile.estateId === estateId
  )
  const xs = selected.map((coords) => coords.x).sort()
  const ys = selected.map((coords) => coords.y).sort()
  const x = xs[(xs.length / 2) | 0] || 0
  const y = ys[(ys.length / 2) | 0] || 0
  const center = { x, y }
  const stream = await getStream(
    map,
    width,
    height,
    size,
    center,
    selected,
    showOnSale
  )
  return {
    status: 200,
    body: stream,
    headers: {
      'content-type': 'image/png',
    },
  }
}

export async function pingRequestHandler(ctx: {
  components: Pick<AppComponents, 'map'>
}) {
  const { map } = ctx.components
  await map.getTiles()
  return {
    status: 200,
    body: {},
  }
}
