import { tileFields } from '../modules/map/types'

const validFields = new Set<string>(tileFields)

export type TilesFilter = {
  /** Whether the filter selects a subset of the tiles or of their fields. */
  isFiltered: boolean
  /** URL holding only the filter params that apply, normalized; serves as the cache key too. */
  url: URL
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
 * coordinates when all of them are numeric, and include/exclude when they name
 * at least one valid field (include wins over exclude).
 */
export function getTilesFilter(url: URL): TilesFilter {
  const filterUrl = new URL('http://tiles/')
  const coords = ['x1', 'y1', 'x2', 'y2'].map((name) =>
    url.searchParams.get(name)
  )
  if (coords.every((value) => value && !isNaN(+value))) {
    const [x1, y1, x2, y2] = coords.map(Number)
    filterUrl.searchParams.set('x1', String(Math.min(x1, x2)))
    filterUrl.searchParams.set('y1', String(Math.min(y1, y2)))
    filterUrl.searchParams.set('x2', String(Math.max(x1, x2)))
    filterUrl.searchParams.set('y2', String(Math.max(y1, y2)))
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
