import { Canvas, createCanvas } from 'canvas'
import {
  getViewport,
  Layer,
  renderMap,
  Tile,
} from '../../../src/modules/render'

const BACKGROUND = [0x18, 0x14, 0x1a, 255]

// largest per-channel difference to the expected RGBA color; tolerates cairo build differences
function colorDistance(
  canvas: Canvas,
  x: number,
  y: number,
  expected: number[]
): number {
  const pixel = canvas.getContext('2d').getImageData(x, y, 1, 1).data
  return Math.max(...expected.map((value, i) => Math.abs(pixel[i] - value)))
}

const TOLERANCE = 2

describe('when rendering the map', () => {
  let canvas: Canvas
  let tiles: Record<string, Tile>
  let layers: Layer[]

  beforeEach(() => {
    // 30x30 px with 10 px tiles: parcels -1..1 on both axes, center (0,0) in the middle;
    // the assertions sample tile centres, away from the padded edges
    canvas = createCanvas(30, 30)
    tiles = {
      '0,0': { color: '#ff0000' },
      '1,1': { color: '#00ff00' },
    }
    layers = [(x, y) => tiles[`${x},${y}`] ?? null]
  })

  describe('and the layers have tiles inside the viewport', () => {
    beforeEach(() => {
      const center = { x: 0, y: 0 }
      const { nw, se } = getViewport({
        width: 30,
        height: 30,
        size: 10,
        padding: 1,
        center,
      })
      renderMap({
        ctx: canvas.getContext('2d'),
        width: 30,
        height: 30,
        size: 10,
        pan: { x: 0, y: 0 },
        nw,
        se,
        center,
        layers,
      })
    })

    it('should paint the center parcel in the middle of the image', () => {
      expect(
        colorDistance(canvas, 15, 15, [255, 0, 0, 255])
      ).toBeLessThanOrEqual(TOLERANCE)
    })

    it('should paint parcels with a greater y above and a greater x to the right', () => {
      expect(
        colorDistance(canvas, 25, 5, [0, 255, 0, 255])
      ).toBeLessThanOrEqual(TOLERANCE)
    })

    it('should paint the background where a layer has no tile', () => {
      expect(colorDistance(canvas, 5, 25, BACKGROUND)).toBeLessThanOrEqual(
        TOLERANCE
      )
    })
  })

  describe('and a later layer has a tile at the same coordinates', () => {
    beforeEach(() => {
      const center = { x: 0, y: 0 }
      const { nw, se } = getViewport({
        width: 30,
        height: 30,
        size: 10,
        padding: 1,
        center,
      })
      layers.push((x, y) => (x === 0 && y === 0 ? { color: '#0000ff' } : null))
      renderMap({
        ctx: canvas.getContext('2d'),
        width: 30,
        height: 30,
        size: 10,
        pan: { x: 0, y: 0 },
        nw,
        se,
        center,
        layers,
      })
    })

    it('should paint the later layer on top', () => {
      expect(
        colorDistance(canvas, 15, 15, [0, 0, 255, 255])
      ).toBeLessThanOrEqual(TOLERANCE)
    })
  })
})
