import { toLegacyTiles } from '../../src/adapters/legacy-tiles'
import { Tile, TileType } from '../../src/modules/map/types'

describe('when converting tiles into a legacy tiles', () => {
  let tile: Tile
  beforeEach(() => {
    tile = {
      id: 'anId',
      x: 1,
      y: 0,
      type: TileType.OWNED,
      top: true,
      topLeft: true,
      left: true,
      updatedAt: Date.now() / 1000,
    }
  })

  describe('and the tile contains a rental listing', () => {
    beforeEach(() => {
      tile.rentalListing = {
        expiration: Date.now(),
        periods: [
          { minDays: 1, maxDays: 1, pricePerDay: '10000' },
          { minDays: 2, maxDays: 2, pricePerDay: '20000' },
        ],
      }
    })

    it('should return the biggest price per day of the periods', () => {
      expect(toLegacyTiles({ [tile.id]: tile })).toEqual({
        [tile.id]: expect.objectContaining({
          rentalPricePerDay: '20000',
        }),
      })
    })
  })

  describe('and the tiles do not contain a rental listing', () => {
    it('should not have pricePerDays property', () => {
      expect(toLegacyTiles({ [tile.id]: tile })).toEqual({
        [tile.id]: expect.not.objectContaining({
          rentalPricePerDay: expect.anything(),
        }),
      })
    })
  })
})
