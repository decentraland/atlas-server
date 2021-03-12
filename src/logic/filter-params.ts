import { Tile, tileFields } from '../modules/map/types'

type FilterQuery = {
  x1?: string
  x2?: string
  y1?: string
  y2?: string
  include?: string
  exclude?: string
}

const validFields = new Set(tileFields)

export function getFilterFromUrl(
  url: URL,
  tiles: Record<string, Tile>
): Record<string, Partial<Tile>> {
  let result: Record<string, Partial<Tile>> = tiles

  // filter by coords
  const x1 = url.searchParams.get('x1')
  const x2 = url.searchParams.get('x2')
  const y1 = url.searchParams.get('y1')
  const y2 = url.searchParams.get('y2')
  const include = url.searchParams.get('include')
  const exclude = url.searchParams.get('exclude')

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

export function extractParams(url: URL) {
  const parse = (
    name: string,
    defaultValue: number,
    minValue: number,
    maxValue: number
  ) =>
    Math.max(
      Math.min(
        url.searchParams.has(name) &&
          !isNaN(parseInt(url.searchParams.get(name) as string))
          ? parseInt(url.searchParams.get(name) as string)
          : defaultValue,
        maxValue
      ),
      minValue
    )
  // params
  const width = parse('width', 1024, 100, 4096)
  const height = parse('height', 1024, 100, 4096)
  const size = parse('size', 20, 5, 50)
  const [x, y] = url.searchParams.has('center')
    ? (url.searchParams.get('center') as string)
        .split(',')
        .map((coord) => +coord)
    : [0, 0]
  const center = { x, y }
  const showOnSale = url.searchParams.get('on-sale') === 'true'
  const selected = url.searchParams.has('selected')
    ? (url.searchParams.get('selected') as string).split(';').map((id) => {
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
