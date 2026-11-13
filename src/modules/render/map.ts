import { CanvasRenderingContext2D } from 'canvas'
import { renderTile } from './tile'
import { Coord, Layer } from './types'
import { assertIterableViewport } from './viewport'

export type RenderMapArgs = {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  size: number
  pan: Coord
  nw: Coord
  se: Coord
  center: Coord
  layers: Layer[]
}

export function renderMap(args: RenderMapArgs) {
  const { ctx, width, height, size, pan, nw, se, center, layers } = args

  assertIterableViewport({ nw, se })

  ctx.fillStyle = '#18141a'
  ctx.fillRect(0, 0, width, height)

  const columns = se.x - nw.x
  const rows = nw.y - se.y
  const halfWidth = width / 2
  const halfHeight = height / 2

  for (const layer of layers) {
    // counted rather than compared against se, so the loops end whatever the corners
    for (let column = 0; column < columns; column++) {
      const x = nw.x + column
      for (let row = 0; row < rows; row++) {
        const y = se.y + row
        const offsetX = (center.x - x) * size + (pan ? pan.x : 0)
        const offsetY = (y - center.y) * size + (pan ? pan.y : 0)

        const tile = layer(x, y)
        if (!tile) {
          continue
        }
        const { color, top, left, topLeft, scale } = tile

        const halfSize = scale ? (size * scale) / 2 : size / 2

        renderTile({
          ctx,
          x: halfWidth - offsetX + halfSize,
          y: halfHeight - offsetY + halfSize,
          size,
          padding: size < 7 ? 0.5 : size < 12 ? 1 : size < 18 ? 1.5 : 2,
          offset: 1,
          color,
          left,
          top,
          topLeft,
          scale,
        })
      }
    }
  }
}
