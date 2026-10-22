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
        updatedAt: Date.now(),
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

  describe.each([
    {
      prices: ['1000000000000000000', '999999999999999999999'],
      expected: '999999999999999999999',
    },
    {
      prices: [
        '115792089237316195423570985008687907853269984665640564039457584007913129639935',
        '1',
      ],
      expected:
        '115792089237316195423570985008687907853269984665640564039457584007913129639935',
    },
    { prices: ['0100', '100'], expected: '0100' },
    { prices: ['0x10', '15'], expected: '0x10' },
    { prices: ['0xff', '256'], expected: '256' },
    { prices: ['-1', '-0x10'], expected: '0' },
  ])(
    'and the rental listing periods have the prices $prices',
    ({ prices, expected }) => {
      beforeEach(() => {
        tile.rentalListing = {
          expiration: Date.now(),
          periods: prices.map((pricePerDay, i) => ({
            minDays: i + 1,
            maxDays: i + 1,
            pricePerDay,
          })),
          updatedAt: Date.now(),
        }
      })

      it(`should use ${expected} as the rental price per day`, () => {
        expect(
          toLegacyTiles({ [tile.id]: tile })[tile.id].rentalPricePerDay
        ).toBe(expected)
      })
    }
  )

  describe.each([[''], [' 5'], ['+5'], ['1.5'], ['0X1F']])(
    'and a rental listing period has the malformed price %p',
    (pricePerDay) => {
      beforeEach(() => {
        tile.rentalListing = {
          expiration: Date.now(),
          periods: [{ minDays: 1, maxDays: 1, pricePerDay }],
          updatedAt: Date.now(),
        }
      })

      it('should throw', () => {
        expect(() => toLegacyTiles({ [tile.id]: tile })).toThrow()
      })
    }
  )

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
