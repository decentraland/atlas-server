import { createCanvas } from 'canvas'
import { Coord, Layer, getViewport, renderMap } from '../../render'
import { IMapComponent, Tile, TileType } from '../map/types'
import { coordsToId } from '../map/utils'
import { IImageComponent } from './types'

export function createImageComponent(components: {
  map: IMapComponent
}): IImageComponent {
  const { map } = components

  function getColor(tile: Tile) {
    if (tile.price) {
      return '#1FBCFF'
    }
    switch (tile.type) {
      case TileType.DISTRICT:
        return '#5054D4'
      case TileType.PLAZA:
        return '#70AC76'
      case TileType.ROAD:
        return '#716C7A'
      case TileType.OWNED:
        return '#3D3A46'
      case TileType.UNOWNED:
        return '#09080A'
    }
  }

  async function getStream(
    width: number,
    height: number,
    size: number,
    center: Coord
  ) {
    const pan = { x: 0, y: 0 }
    const { nw, se } = getViewport({ width, height, center, size, padding: 1 })
    const canvas = createCanvas(width, height)
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    const tiles = await map.getTiles()
    const layer: Layer = (x, y) => {
      const id = coordsToId(x, y)
      const tile = tiles[id]
      const result = tile
        ? {
            color: getColor(tile),
            top: tile.top,
            left: tile.left,
            topLeft: tile.topLeft,
          }
        : {
            color: (x + y) % 2 === 0 ? '#110e13' : '#0d0b0e',
          }
      return result
    }
    renderMap({
      ctx,
      width,
      height,
      size,
      pan,
      center,
      nw,
      se,
      layers: [layer],
    })
    return canvas.createPNGStream()
  }
  return {
    getStream,
  }
}
