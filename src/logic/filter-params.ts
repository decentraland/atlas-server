import { Tile, tileFields } from '../modules/map/types'
import { Coord } from '../modules/render'
import { InvalidRequestError } from './error'

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
  } else if (exclude) {
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

// bounds the work of a single render: canvas pixels and tiles drawn per layer
export const MAX_IMAGE_PIXELS = 2048 * 2048
export const MAX_IMAGE_TILES = 40000

const INTEGER_PATTERN = /^-?\d+$/

/**
 * Parses a coordinate strictly: only an optionally signed run of digits is accepted.
 * @throws InvalidRequestError when the value is not a safe integer.
 */
export function parseCoordinate(value: string, name: string): number {
  const coordinate = Number(value)
  if (!INTEGER_PATTERN.test(value) || !Number.isSafeInteger(coordinate)) {
    throw new InvalidRequestError(`Invalid ${name}: expected an integer`)
  }
  return coordinate
}

function parseCoords(value: string, name: string): Coord {
  const parts = value.split(',')
  if (parts.length !== 2) {
    throw new InvalidRequestError(`Invalid ${name}: expected "x,y"`)
  }
  return {
    x: parseCoordinate(parts[0], name),
    y: parseCoordinate(parts[1], name),
  }
}

/**
 * Reads the image params of the map PNG routes.
 * @throws InvalidRequestError when a coordinate is malformed or the image exceeds the render budget.
 */
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
  if (width * height > MAX_IMAGE_PIXELS) {
    throw new InvalidRequestError(
      `Image too large: width * height must be at most ${MAX_IMAGE_PIXELS} pixels`
    )
  }
  if (Math.ceil(width / size) * Math.ceil(height / size) > MAX_IMAGE_TILES) {
    throw new InvalidRequestError(
      `Too many tiles: (width / size) * (height / size) must be at most ${MAX_IMAGE_TILES}`
    )
  }
  const centerParam = url.searchParams.get('center')
  const center =
    centerParam !== null ? parseCoords(centerParam, 'center') : { x: 0, y: 0 }
  const showOnSale = url.searchParams.get('on-sale') === 'true'
  const showListedForRent = url.searchParams.get('listed-for-rent') === 'true'
  const selectedParam = url.searchParams.get('selected')
  const selected = selectedParam
    ? selectedParam
        .split(';')
        .filter((id) => id !== '')
        .map((id) => parseCoords(id, 'selected'))
    : []
  return {
    width,
    height,
    size,
    center,
    showOnSale,
    showListedForRent,
    selected,
  }
}
