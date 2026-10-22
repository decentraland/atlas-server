import { Canvas, createCanvas } from 'canvas'
import {
  getViewport,
  Layer,
  renderMap,
  Tile,
} from '../../../src/modules/render'

const BACKGROUND = [0x18, 0x14, 0x1a, 255]

function pixelAt(canvas: Canvas, x: number, y: number): number[] {
  return Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data)
}

describe('when rendering the map', () => {
  let canvas: Canvas
  let tiles: Record<string, Tile>
  let layers: Layer[]

  beforeEach(() => {
    // 30x30 px with 10 px tiles: parcels -1..1 on both axes, center (0,0) in the middle
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
      expect(pixelAt(canvas, 15, 15)).toEqual([255, 0, 0, 255])
    })

    it('should paint parcels with a greater y above and a greater x to the right', () => {
      expect(pixelAt(canvas, 25, 5)).toEqual([0, 255, 0, 255])
    })

    it('should paint the background where a layer has no tile', () => {
      expect(pixelAt(canvas, 5, 25)).toEqual(BACKGROUND)
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
      expect(pixelAt(canvas, 15, 15)).toEqual([0, 0, 255, 255])
    })
  })
})
