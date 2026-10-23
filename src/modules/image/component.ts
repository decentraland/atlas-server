import { Coord, Layer, describeMap, getViewport } from '../render'
import { Tile, TileType } from '../map/types'
import { coordsToId } from '../map/utils'
import { MapRenderJob } from '../../adapters/render-pool'
import { IImageComponent } from './types'

/**
 * Builds the render jobs of the map images. An image is a function of the tiles it is given
 * and its params only, so it always matches the version of those tiles.
 * @returns the image component.
 */
export function createImageComponent(): IImageComponent {
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

  function getRenderJob(
    tiles: Record<string, Tile>,
    width: number,
    height: number,
    size: number,
    center: Coord,
    selected: Coord[],
    showOnSale: boolean,
    showOnRent: boolean
  ): MapRenderJob {
    const pan = { x: 0, y: 0 }
    const { nw, se } = getViewport({ width, height, center, size, padding: 1 })
    const layer: Layer = (x, y) => {
      const id = coordsToId(x, y)
      const tile = tiles[id]
      // no clock here: the map drops expired orders and rentals on every refresh
      const isOnSale = showOnSale && tile && tile.price
      const isListedForRent = showOnRent && tile && tile.rentalListing
      const result = tile
        ? {
            color: isOnSale || isListedForRent ? '#1FBCFF' : getColor(tile),
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

    // the layers close over the tiles, so they are resolved here and drawn on a worker
    return {
      kind: 'map',
      scene: describeMap({
        width,
        height,
        size,
        pan,
        center,
        nw,
        se,
        layers,
      }),
    }
  }
  return {
    getRenderJob,
  }
}
