export function renderTile(args: {
  ctx: CanvasRenderingContext2D
  x: number
  y: number
  size: number
  padding: number
  offset: number
  color: string
  left?: boolean
  top?: boolean
  topLeft?: boolean
  scale?: number
}) {
  const { ctx, x, y, size, padding, offset, color, left, top, topLeft, scale } = args

  ctx.fillStyle = color

  const tileSize = scale ? size * scale : size

  if (!top && !left) {
    // disconnected everywhere: it's a square
    ctx.fillRect(
      x - tileSize + padding,
      y - tileSize + padding,
      tileSize - padding,
      tileSize - padding
    )
  } else if (top && left && topLeft) {
    // connected everywhere: it's a square
    ctx.fillRect(
      x - tileSize - offset,
      y - tileSize - offset,
      tileSize + offset,
      tileSize + offset
    )
  } else {
    if (left) {
      // connected left: it's a rectangle
      ctx.fillRect(
        x - tileSize - offset,
        y - tileSize + padding,
        tileSize + offset,
        tileSize - padding
      )
    }
    if (top) {
      // connected top: it's a rectangle
      ctx.fillRect(
        x - tileSize + padding,
        y - tileSize - offset,
        tileSize - padding,
        tileSize + offset
      )
    }
  }
}
