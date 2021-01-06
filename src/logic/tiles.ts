import { LegacyTile, Tile, tileFields, TileType } from '../modules/map/types'

type FilterQuery = {
  x1?: string
  x2?: string
  y1?: string
  y2?: string
  include?: string
  exclude?: string
}

const validFields = new Set(tileFields)

export function extractQueryParams(
  queryParams: Record<string, string | string[]>
) {
  const parse = (
    name: string,
    defaultValue: number,
    minValue: number,
    maxValue: number
  ) =>
    Math.max(
      Math.min(
        name in queryParams && !isNaN(parseInt(queryParams[name] as string))
          ? parseInt(queryParams[name] as string)
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
    'center' in queryParams
      ? (queryParams['center'] as string).split(',').map((coord) => +coord)
      : [0, 0]
  const center = { x, y }
  const showOnSale = queryParams['on-sale'] === 'true'
  const selected =
    'selected' in queryParams
      ? (queryParams.selected as string).split(';').map((id) => {
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

// helpers to convert to legacy format
export function toLegacyTiles(tiles: Record<string, Partial<Tile>>) {
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

export function filterTiles(
  queryParams: FilterQuery,
  tiles: Record<string, Tile>
): Record<string, Partial<Tile>> {
  let result: Record<string, Partial<Tile>> = tiles

  // filter by coords
  const { x1, x2, y1, y2, include, exclude } = queryParams
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
        result[tile.id] = tile
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
