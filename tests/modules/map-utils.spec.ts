import { Tile, TileType } from '../../src/modules/map/types'
import { hasStaleSpecialTiles } from '../../src/modules/map/utils'

jest.mock('../../src/modules/map/data/specialTiles.json', () => ({
  '0,0': {
    id: '0,0',
    type: 'plaza',
    top: false,
    left: false,
    topLeft: false,
    name: 'Genesis Plaza',
  },
}))

function buildTile(id: string, type: TileType): Tile {
  const [x, y] = id.split(',').map(Number)
  return {
    id,
    x,
    y,
    type,
    top: false,
    left: false,
    topLeft: false,
    updatedAt: 0,
  }
}

describe('when checking cached tiles against the special tiles', () => {
  let tiles: Tile[]

  describe('and every special tile keeps its current type', () => {
    beforeEach(() => {
      tiles = [
        buildTile('0,0', TileType.PLAZA),
        buildTile('1,1', TileType.OWNED),
      ]
    })

    it('should report them as up to date', () => {
      expect(hasStaleSpecialTiles(tiles)).toBe(false)
    })
  })

  describe('and a tile has a special type its id no longer has', () => {
    beforeEach(() => {
      tiles = [
        buildTile('0,0', TileType.PLAZA),
        buildTile('1,1', TileType.DISTRICT),
      ]
    })

    it('should report them as stale', () => {
      expect(hasStaleSpecialTiles(tiles)).toBe(true)
    })
  })

  describe('and a special tile id has a different type', () => {
    beforeEach(() => {
      tiles = [buildTile('0,0', TileType.OWNED)]
    })

    it('should report them as stale', () => {
      expect(hasStaleSpecialTiles(tiles)).toBe(true)
    })
  })

  describe('and a special tile id is missing', () => {
    beforeEach(() => {
      tiles = [buildTile('1,1', TileType.UNOWNED)]
    })

    it('should report them as up to date', () => {
      expect(hasStaleSpecialTiles(tiles)).toBe(false)
    })
  })
})
