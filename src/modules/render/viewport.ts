import { Coord } from './types'

export type Viewport = {
  width: number
  height: number
  nw: Coord
  se: Coord
  area: number
}

/**
 * Checks that a loop from nw to se visits every parcel and ends. Past 2^53 a number
 * cannot be incremented, so `for (x = nw.x; x < se.x; x++)` would never finish.
 * @throws RangeError when a corner is not a safe integer or the span is negative or inexact.
 */
export function assertIterableViewport(viewport: Pick<Viewport, 'nw' | 'se'>) {
  const { nw, se } = viewport
  const columns = se.x - nw.x
  const rows = nw.y - se.y
  if (
    ![nw.x, nw.y, se.x, se.y, columns, rows].every(Number.isSafeInteger) ||
    columns < 0 ||
    rows < 0
  ) {
    throw new RangeError('The viewport is outside the range that can be drawn')
  }
}

export function getViewport(args: {
  width: number
  height: number
  center: Coord
  size: number
  padding: number
  pan?: Coord
}): Viewport {
  const { width, height, center, pan, size, padding } = args
  const dimensions = {
    width: Math.ceil(width / size + padding),
    height: Math.ceil(height / size + padding),
  }
  const panX = pan ? Math.ceil(pan.x / size) : 0
  const panY = pan ? Math.ceil(pan.y / size) : 0
  const nw = {
    x: center.x - Math.ceil(dimensions.width / 2) + panX,
    y: center.y + Math.ceil(dimensions.height / 2) - panY,
  }
  const se = {
    x: center.x + Math.ceil(dimensions.width / 2) + panX,
    y: center.y - Math.ceil(dimensions.height / 2) - panY,
  }
  assertIterableViewport({ nw, se })
  const area = (se.x - nw.x) * (nw.y - se.y)

  return {
    ...dimensions,
    nw,
    se,
    area,
  }
}
