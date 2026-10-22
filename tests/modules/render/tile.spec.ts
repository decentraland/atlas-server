import { CanvasRenderingContext2D } from 'canvas'
import { renderTile } from '../../../src/modules/render'

type FakeContext = {
  fillStyle: string
  fillRect: jest.Mock
}

describe('when rendering a tile', () => {
  let ctx: FakeContext
  let args: Parameters<typeof renderTile>[0]

  beforeEach(() => {
    ctx = { fillStyle: '', fillRect: jest.fn() }
    args = {
      ctx: ctx as unknown as CanvasRenderingContext2D,
      x: 100,
      y: 200,
      size: 10,
      padding: 1,
      offset: 1,
      color: '#ff0000',
    }
  })

  describe('and the tile is not connected to any neighbour', () => {
    beforeEach(() => {
      renderTile(args)
    })

    it('should paint the tile with its color', () => {
      expect(ctx.fillStyle).toBe('#ff0000')
    })

    it('should draw a single square inset by the padding', () => {
      expect(ctx.fillRect.mock.calls).toEqual([[91, 191, 9, 9]])
    })
  })

  describe('and the tile is connected to its top, left and top left neighbours', () => {
    beforeEach(() => {
      renderTile({ ...args, top: true, left: true, topLeft: true })
    })

    it('should draw a single square grown by the offset to merge with them', () => {
      expect(ctx.fillRect.mock.calls).toEqual([[89, 189, 11, 11]])
    })
  })

  describe('and the tile is connected only to its left neighbour', () => {
    beforeEach(() => {
      renderTile({ ...args, left: true })
    })

    it('should draw a rectangle stretched towards the left', () => {
      expect(ctx.fillRect.mock.calls).toEqual([[89, 191, 11, 9]])
    })
  })

  describe('and the tile is connected only to its top neighbour', () => {
    beforeEach(() => {
      renderTile({ ...args, top: true })
    })

    it('should draw a rectangle stretched towards the top', () => {
      expect(ctx.fillRect.mock.calls).toEqual([[91, 189, 9, 11]])
    })
  })

  describe('and the tile is connected to its top and left neighbours but not the top left one', () => {
    beforeEach(() => {
      renderTile({ ...args, top: true, left: true })
    })

    it('should draw both rectangles, leaving the top left corner empty', () => {
      expect(ctx.fillRect.mock.calls).toEqual([
        [89, 191, 11, 9],
        [91, 189, 9, 11],
      ])
    })
  })

  describe('and the tile is scaled', () => {
    beforeEach(() => {
      renderTile({ ...args, scale: 2 })
    })

    it('should draw the square with the scaled size', () => {
      expect(ctx.fillRect.mock.calls).toEqual([[81, 181, 19, 19]])
    })
  })
})
