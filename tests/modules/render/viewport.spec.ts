import { getViewport, Viewport } from '../../../src/modules/render'

describe('when computing the viewport of a map image', () => {
  let viewport: Viewport

  describe('and the image is centered on the origin without panning', () => {
    beforeEach(() => {
      viewport = getViewport({
        width: 100,
        height: 60,
        size: 10,
        padding: 1,
        center: { x: 0, y: 0 },
      })
    })

    it('should span the image in tiles plus the padding around the center', () => {
      expect(viewport).toEqual({
        width: 11,
        height: 7,
        nw: { x: -6, y: 4 },
        se: { x: 6, y: -4 },
        area: 96,
      })
    })
  })

  describe('and the image is centered on another parcel', () => {
    beforeEach(() => {
      viewport = getViewport({
        width: 100,
        height: 60,
        size: 10,
        padding: 1,
        center: { x: 20, y: -30 },
      })
    })

    it('should move the corners along with the center', () => {
      expect({ nw: viewport.nw, se: viewport.se }).toEqual({
        nw: { x: 14, y: -26 },
        se: { x: 26, y: -34 },
      })
    })
  })

  describe('and the image is panned', () => {
    beforeEach(() => {
      viewport = getViewport({
        width: 100,
        height: 60,
        size: 10,
        padding: 1,
        center: { x: 0, y: 0 },
        pan: { x: 25, y: 15 },
      })
    })

    it('should shift the corners by the panned tiles, rounded up', () => {
      expect({ nw: viewport.nw, se: viewport.se }).toEqual({
        nw: { x: -3, y: 2 },
        se: { x: 9, y: -6 },
      })
    })
  })

  describe('and the image size is not a multiple of the tile size', () => {
    beforeEach(() => {
      viewport = getViewport({
        width: 105,
        height: 61,
        size: 10,
        padding: 0,
        center: { x: 0, y: 0 },
      })
    })

    it('should round the dimensions up so the image is fully covered', () => {
      expect({ width: viewport.width, height: viewport.height }).toEqual({
        width: 11,
        height: 7,
      })
    })
  })
})
