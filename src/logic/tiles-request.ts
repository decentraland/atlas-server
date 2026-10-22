import { tileFields } from '../modules/map/types'

const validFields = new Set<string>(tileFields)

export type TilesFilter = {
  /** Whether the filter selects a subset of the tiles or of their fields. */
  isFiltered: boolean
  /** URL holding only the filter params that apply, normalized; serves as the cache key too. */
  url: URL
}

export type MapBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function getMapBounds(
  tiles: Iterable<{ x: number; y: number }>
): MapBounds | null {
  let bounds: MapBounds | null = null
  for (const { x, y } of tiles) {
    if (!bounds) {
      bounds = { minX: x, minY: y, maxX: x, maxY: y }
      continue
    }
    if (x < bounds.minX) bounds.minX = x
    if (y < bounds.minY) bounds.minY = y
    if (x > bounds.maxX) bounds.maxX = x
    if (y > bounds.maxY) bounds.maxY = y
  }
  return bounds
}

type Box = { x1: number; y1: number; x2: number; y2: number }

// boxes that select the same tiles share one key: clamped to the map, the whole map is no filter at all
function clampToBounds(box: Box, bounds: MapBounds): Box | null {
  const { minX, minY, maxX, maxY } = bounds
  if (box.x2 < minX || box.x1 > maxX || box.y2 < minY || box.y1 > maxY) {
    return { x1: maxX + 1, y1: maxY + 1, x2: maxX + 1, y2: maxY + 1 }
  }
  const clamped = {
    x1: Math.max(box.x1, minX),
    y1: Math.max(box.y1, minY),
    x2: Math.min(box.x2, maxX),
    y2: Math.min(box.y2, maxY),
  }
  const coversMap =
    clamped.x1 === minX &&
    clamped.y1 === minY &&
    clamped.x2 === maxX &&
    clamped.y2 === maxY
  return coversMap ? null : clamped
}

function getValidFields(value: string | null): string[] {
  if (!value) {
    return []
  }
  return Array.from(
    new Set(value.split(',').filter((field) => validFields.has(field)))
  )
}

/**
 * Keeps only the tiles filter params that change the response: the four
 * coordinates when all of them are numeric (clamped to the map bounds when
 * given), and include/exclude when they name at least one valid field (include
 * wins over exclude).
 */
export function getTilesFilter(
  url: URL,
  bounds?: MapBounds | null
): TilesFilter {
  const filterUrl = new URL('http://tiles/')
  const coords = ['x1', 'y1', 'x2', 'y2'].map((name) =>
    url.searchParams.get(name)
  )
  if (coords.every((value) => value && !isNaN(+value))) {
    const [x1, y1, x2, y2] = coords.map(Number)
    const box: Box | null = {
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
    }
    const applied = bounds ? clampToBounds(box, bounds) : box
    if (applied) {
      filterUrl.searchParams.set('x1', String(applied.x1))
      filterUrl.searchParams.set('y1', String(applied.y1))
      filterUrl.searchParams.set('x2', String(applied.x2))
      filterUrl.searchParams.set('y2', String(applied.y2))
    }
  }

  const include = getValidFields(url.searchParams.get('include'))
  const exclude = getValidFields(url.searchParams.get('exclude'))
  if (include.length > 0) {
    filterUrl.searchParams.set('include', include.join(','))
  } else if (exclude.length > 0) {
    filterUrl.searchParams.set('exclude', exclude.sort().join(','))
  }

  return { isFiltered: filterUrl.search !== '', url: filterUrl }
}
