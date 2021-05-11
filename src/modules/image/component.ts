import { createCanvas } from 'canvas'
import { Coord, Layer, getViewport, renderMap } from '../render'
import { IMapComponent, Tile, TileType } from '../map/types'
import { coordsToId, isExpired } from '../map/utils'
import { IImageComponent } from './types'

export function createImageComponent(components: {
  map: IMapComponent
}): IImageComponent {
  const { map } = components

  function getColor(tile: Tile) {
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
    center: Coord,
    selected: Coord[],
    showOnSale: boolean
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
          color: showOnSale && tile.price && !isExpired(tile) ? '#1FBCFF' : getColor(tile),
          top: tile.top,
          left: tile.left,
          topLeft: tile.topLeft,
        }
        : {
          color: (x + y) % 2 === 0 ? '#110e13' : '#0d0b0e',
        }
      return result
    }
    const layers = [layer]

    // render selected tiles
    if (selected.length > 0) {
      const selection = new Set(
        selected.map((coords) => coordsToId(coords.x, coords.y))
      )
      const strokeLayer: Layer = (x, y) =>
        selection.has(coordsToId(x, y))
          ? { color: '#ff0044', scale: 1.4 }
          : null
      const fillLayer: Layer = (x, y) =>
        selection.has(coordsToId(x, y))
          ? { color: '#ff9990', scale: 1.2 }
          : null
      layers.push(strokeLayer)
      layers.push(fillLayer)
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
      layers,
    })
    return canvas.createPNGStream()
  }
  return {
    getStream,
  }
}
