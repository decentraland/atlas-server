import { Request, RequestHandler } from 'express'
import { utils } from 'decentraland-commons'
import { LegacyTile, Tile, tileFields, TileType } from '../modules/map/types'
import { IRequest } from '../modules/server/types'
import { AppComponents } from '../types'
import { Histogram } from 'prom-client'

type FilterQuery = {
  x1?: string
  x2?: string
  y1?: string
  y2?: string
  include?: string
  exclude?: string
}

const validFields = new Set(tileFields)

function filter(
  req: IRequest<FilterQuery>,
  tiles: Record<string, Tile>
): Record<string, Partial<Tile>> {
  let result: Record<string, Partial<Tile>> = tiles

  // filter by coords
  const { x1, x2, y1, y2, include, exclude } = req.query
  if (
    x1 &&
    x2 &&
    y1 &&
    y2 &&
    !isNaN(+x1) &&
    !isNaN(+x2) &&
    !isNaN(+y1) &&
    !isNaN(+y2)
  ) {
    const minX = Math.min(+x1, +x2)
    const maxX = Math.max(+x1, +x2)
    const minY = Math.min(+y1, +y2)
    const maxY = Math.max(+y1, +y2)

    result = {}
    for (const tile of Object.values(tiles)) {
      if (
        tile.x >= minX &&
        tile.x <= maxX &&
        tile.y >= minY &&
        tile.y <= maxY
      ) {
        // Remove parcel and estate properties which are only useful for return the specific asset
        result[tile.id] = utils.omit(tile, ['parcel', 'estate'])
      }
    }
  }

  // include fields
  if (include) {
    const fieldsToInclude = include
      .split(',')
      .filter((field) => validFields.has(field))
    result = Object.keys(result).reduce((newResult, id) => {
      const tile = result[id]
      const newTile: Partial<Tile> = {}
      for (const field of fieldsToInclude) {
        // @ts-ignore
        newTile[field] = tile[field]
      }
      newResult[id] = newTile
      return newResult
    }, {} as typeof result)
  } else if (exclude && result.length > 0) {
    const fieldsToExclude = exclude.split(',')
    const fieldsInclude = Array.from(validFields).filter(
      (field) => !fieldsToExclude.includes(field)
    )
    result = Object.keys(result).reduce((newResult, id) => {
      const tile = result[id]
      const newTile: Partial<Tile> = {}
      for (const field of fieldsInclude) {
        // @ts-ignore
        newTile[field] = tile[field]
      }
      newResult[id] = newTile
      return newResult
    }, {} as typeof result)
  }

  return result
}

export const createTilesRequestHandler = (
  components: Pick<AppComponents, 'server' | 'map'>
) => {
  const { server, map } = components
  return server.cache(
    async (req) => {
      const tiles = await map.getTiles()
      return {
        status: 200,
        body: filter(req, tiles),
      }
    },
    [map.getLastUpdatedAt]
  )
}

export const createLegacyTilesRequestHandler = (
  components: Pick<AppComponents, 'server' | 'map'>
) => {
  const { server, map } = components
  return server.cache(
    async (req) => {
      const tiles = await map.getTiles()
      return {
        status: 200,
        body: toLegacyTiles(filter(req, tiles)),
      }
    },
    [map.getLastUpdatedAt]
  )
}

function extractParams(req: Request) {
  const parse = (
    name: string,
    defaultValue: number,
    minValue: number,
    maxValue: number
  ) =>
    Math.max(
      Math.min(
        name in req.query && !isNaN(parseInt(req.query[name] as string))
          ? parseInt(req.query[name] as string)
          : defaultValue,
        maxValue
      ),
      minValue
    )
  // params
  const width = parse('width', 1024, 100, 4096)
  const height = parse('height', 1024, 100, 4096)
  const size = parse('size', 20, 5, 50)
  const [x, y] =
    'center' in req.query
      ? (req.query['center'] as string).split(',').map((coord) => +coord)
      : [0, 0]
  const center = { x, y }
  const showOnSale = req.query['on-sale'] === 'true'
  const selected =
    'selected' in req.query
      ? (req.query.selected as string).split(';').map((id) => {
        const [x, y] = id.split(',').map((coord) => parseInt(coord))
        return { x, y }
      })
      : []
  return {
    width,
    height,
    size,
    center,
    showOnSale,
    selected,
  }
}

const mapGenerationHistogram = new Histogram({
  name: 'dcl_map_render_time',
  help: 'map render time',
  buckets: [0.1, 5, 15, 50, 100, 500],
})

export const createMapPngRequestHandler = (
  components: Pick<AppComponents, 'image'>
): RequestHandler => {
  const { image } = components
  return async (req, res) => {
    try {
      const {
        width,
        height,
        size,
        center,
        showOnSale,
        selected,
      } = extractParams(req)
      const startTime = Date.now()
      const stream = await image.getStream(
        width,
        height,
        size,
        center,
        selected,
        showOnSale
      )
      mapGenerationHistogram.observe(Date.now() - startTime)
      res.type('png')
      stream.pipe(res)
    } catch (error) {
      res.status(500).send(JSON.stringify({ error: error.message }))
    }
  }
}

export const createParcelMapPngRequestHandler = (
  components: Pick<AppComponents, 'image'>
): RequestHandler => {
  const { image } = components
  return async (req, res) => {
    try {
      const { width, height, size, showOnSale } = extractParams(req)
      const center = {
        x: parseInt(req.params.x) || 0,
        y: parseInt(req.params.y) || 0,
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
      res.type('png')
      stream.pipe(res)
    } catch (error) {
      res.status(500).send(JSON.stringify({ error: error.message }))
    }
  }
}

export const createEstateMapPngRequestHandler = (
  components: Pick<AppComponents, 'image' | 'map'>
): RequestHandler => {
  const { image, map } = components
  return async (req, res) => {
    try {
      const { width, height, size, showOnSale } = extractParams(req)
      const estateId = req.params.id
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
      res.type('png')
      stream.pipe(res)
    } catch (error) {
      res.status(500).send(JSON.stringify({ error: error.message }))
    }
  }
}

export const createParcelRequestHandler = (
  components: Pick<AppComponents, 'nft' | 'map'>
): RequestHandler => {
  const { nft, map } = components
  return async (req, res) => {
    const { x, y } = req.params
    try {
      const tiles = await map.getTiles()
      const selected = Object.values(tiles).filter(
        (tile) => tile.x === parseInt(x) && tile.y === parseInt(y)
      )[0]

      const parcel = await nft.getParcelFromTile(selected)

      if (parcel) {
        res.status(200).json(parcel)
      } else {
        res.status(404).json({ error: 'Not Found' })
      }
    } catch (error) {
      res.status(500).json({ error })
    }
  }
}

export const createEstateRequestHandler = (
  components: Pick<AppComponents, 'nft' | 'map'>
): RequestHandler => {
  const { nft, map } = components
  return async (req, res) => {
    const { id } = req.params
    try {
      const tiles = await map.getTiles()
      const selectedTiles = Object.values(tiles).filter(
        (tile) => tile.estateId === id
      )

      if (selectedTiles) {
        const estate = await nft.getEstateFromTile(selectedTiles)
        res.status(200).json(estate)
      } else {
        res.status(404).json({ error: 'Estate not found. Chances are that it was dissolved' })
      }
    } catch (error) {
      res.status(500).json({ error })
    }
  }
}

export const createTokenRequestHandler = (
  components: Pick<AppComponents, 'nft' | 'map'>
): RequestHandler => {
  const { nft, map } = components
  return async (req, res) => {
    const { address, id } = req.params
    try {
      const tiles = await map.getTiles()

      const selected = Object.values(tiles).filter(
        (tile) =>
          (tile.parcel.contractAddress === address.toLowerCase() && tile.parcel.tokenId === id) ||
          (tile.estate && tile.estate.contractAddress === address.toLowerCase() && tile.estate.tokenId === id)
      )

      const token = await nft.getNFTFromTile(selected)
      if (token) {
        res.status(200).json(token)
      } else {
        res.status(404).json({ error: 'Not Found' })
      }
    } catch (error) {
      res.status(500).json({ error })
    }
  }
}

// helpers to convert to legacy format
function toLegacyTiles(tiles: Record<string, Partial<Tile>>) {
  const legacyTiles: Record<string, Partial<LegacyTile>> = {}
  for (const id in tiles) {
    legacyTiles[id] = toLegacyTile(tiles[id])
  }
  return legacyTiles
}

function toLegacyTile(tile: Partial<Tile>): Partial<LegacyTile> {
  const legacyTile: Partial<LegacyTile> = {}
  if (tile.type) legacyTile.type = getLegacyTile(tile)
  if ('x' in tile) legacyTile.x = tile.x
  if ('y' in tile) legacyTile.y = tile.y
  if (tile.top) legacyTile.top = 1
  if (tile.left) legacyTile.left = 1
  if (tile.topLeft) legacyTile.topLeft = 1
  if (tile.owner) legacyTile.owner = tile.owner
  if (tile.name) legacyTile.name = tile.name
  if (tile.estateId) legacyTile.estate_id = tile.estateId
  if (tile.price) legacyTile.price = tile.price

  return legacyTile
}

function getLegacyTile(tile: Partial<Tile>): number {
  if (tile.price != null) {
    return 10
  }
  switch (tile.type) {
    case TileType.DISTRICT:
      return 5
    case TileType.OWNED:
      return 9
    case TileType.UNOWNED:
      return 11
    case TileType.PLAZA:
      return 8
    case TileType.ROAD:
      return 7
    default:
      return -1
  }
}

export function createPingRequestHandler(
  components: Pick<AppComponents, 'map' | 'server'>
) {
  const { server, map } = components
  return server.handle(async () => {
    await map.getTiles()
    return {
      status: 200,
      body: 'ok',
    }
  })
}
