import { Tile, TileType } from '../../src/modules/map/types'
import {
  getEstateDependentIds,
  getEstateFlags,
} from '../../src/modules/map/utils'

jest.mock('../../src/modules/map/data/specialTiles.json', () => ({}))

function buildTile(id: string, estateId?: string): Tile {
  const [x, y] = id.split(',').map(Number)
  return {
    id,
    x,
    y,
    type: TileType.OWNED,
    top: false,
    left: false,
    topLeft: false,
    updatedAt: 0,
    estateId,
  }
}

function toRecord(tiles: Tile[]): Record<string, Tile> {
  return Object.fromEntries(tiles.map((tile) => [tile.id, tile]))
}

describe('when getting the estate flags of a tile', () => {
  let tiles: Record<string, Tile>

  describe('and the tile is not in an estate', () => {
    beforeEach(() => {
      tiles = toRecord([buildTile('1,1'), buildTile('0,1')])
    })

    it('should return null', () => {
      expect(getEstateFlags(1, 1, tiles)).toBeNull()
    })
  })

  describe('and its top, left and top left neighbours are in the same estate', () => {
    beforeEach(() => {
      tiles = toRecord([
        buildTile('1,1', '7'),
        buildTile('1,2', '7'),
        buildTile('0,1', '7'),
        buildTile('0,2', '7'),
      ])
    })

    it('should stitch the tile to all of them', () => {
      expect(getEstateFlags(1, 1, tiles)).toEqual({
        top: true,
        left: true,
        topLeft: true,
      })
    })
  })

  describe('and only its left neighbour is in the same estate', () => {
    beforeEach(() => {
      tiles = toRecord([
        buildTile('1,1', '7'),
        buildTile('1,2', '8'),
        buildTile('0,1', '7'),
      ])
    })

    it('should stitch the tile only to its left', () => {
      expect(getEstateFlags(1, 1, tiles)).toEqual({
        top: false,
        left: true,
        topLeft: false,
      })
    })
  })
})

describe('when getting the tiles whose estate flags depend on a tile', () => {
  it('should return the tile, its right, its bottom and its bottom right neighbours', () => {
    expect(getEstateDependentIds(1, 1)).toEqual(['1,1', '2,1', '1,0', '2,0'])
  })
})
