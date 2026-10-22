const TILES_FILTER_PARAMS = ['x1', 'y1', 'x2', 'y2', 'include', 'exclude']

/** Whether the request asks for a subset of the tiles or of their fields. */
export function hasTilesFilterParams(url: URL): boolean {
  return TILES_FILTER_PARAMS.some((name) => url.searchParams.has(name))
}

/** Cache key built only from the filter params, so unrelated params or hosts share entries. */
export function getTilesCacheKey(url: URL): string {
  return JSON.stringify(
    TILES_FILTER_PARAMS.map((name) => url.searchParams.get(name))
  )
}
