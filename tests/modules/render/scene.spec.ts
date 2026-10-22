import {
  Coord,
  describeMap,
  getSceneLayers,
  getSceneTransferList,
  getViewport,
  Layer,
  MapScene,
  Tile,
} from '../../../src/modules/render'

function readLayers(layers: Layer[], nw: Coord, se: Coord): (Tile | null)[][] {
  return layers.map((layer) => {
    const tiles: (Tile | null)[] = []
    for (let x = nw.x; x < se.x; x++) {
      for (let y = se.y; y < nw.y; y++) {
        tiles.push(layer(x, y))
      }
    }
    return tiles
  })
}

describe('when describing a map render as a scene', () => {
  let center: Coord
  let layers: Layer[]
  let scene: MapScene

  beforeEach(() => {
    layers = [
      (x, y) =>
        (x + y) % 2 === 0
          ? { color: '#3D3A46', top: true, left: x > 0, topLeft: y > 0 }
          : { color: '#09080A', top: false, left: false, topLeft: false },
      (x, y) => (x === 0 && y === 0 ? { color: '#ff0044', scale: 1.4 } : null),
      (x, y) => (x === 0 && y === 0 ? { color: '#ff9990', scale: 1.2 } : null),
    ]
  })

  describe('and the viewport is around the center of the map', () => {
    beforeEach(() => {
      center = { x: 0, y: 0 }
      const { nw, se } = getViewport({
        width: 100,
        height: 60,
        size: 10,
        padding: 1,
        center,
      })
      scene = describeMap({
        width: 100,
        height: 60,
        size: 10,
        pan: { x: 0, y: 0 },
        center,
        nw,
        se,
        layers,
      })
    })

    it('should give back the tile of every layer at every parcel of the viewport', () => {
      expect(readLayers(getSceneLayers(scene), scene.nw, scene.se)).toEqual(
        readLayers(layers, scene.nw, scene.se).map((tiles) =>
          tiles.map((tile) =>
            tile
              ? {
                  color: tile.color,
                  top: !!tile.top,
                  left: !!tile.left,
                  topLeft: !!tile.topLeft,
                  scale: tile.scale,
                }
              : null
          )
        )
      )
    })

    it('should keep each color and scale once in the palette', () => {
      expect(scene.palette).toEqual([
        { color: '#3D3A46' },
        { color: '#09080A' },
        { color: '#ff0044', scale: 1.4 },
        { color: '#ff9990', scale: 1.2 },
      ])
    })

    it('should transfer the buffers of every layer', () => {
      expect(getSceneTransferList(scene)).toHaveLength(6)
    })
  })

  describe('and the viewport is centered far beyond 16 bit coordinates', () => {
    beforeEach(() => {
      center = {
        x: Number.MAX_SAFE_INTEGER - 100,
        y: -(Number.MAX_SAFE_INTEGER - 100),
      }
      layers = [(x) => ({ color: x % 2 === 0 ? '#000000' : '#ffffff' })]
      const { nw, se } = getViewport({
        width: 100,
        height: 100,
        size: 20,
        padding: 1,
        center,
      })
      scene = describeMap({
        width: 100,
        height: 100,
        size: 20,
        pan: { x: 0, y: 0 },
        center,
        nw,
        se,
        layers,
      })
    })

    it('should give back the tile at each parcel', () => {
      expect(
        readLayers(getSceneLayers(scene), scene.nw, scene.se)[0].map(
          (tile) => tile?.color
        )
      ).toEqual(
        readLayers(layers, scene.nw, scene.se)[0].map((tile) => tile?.color)
      )
    })
  })
})
