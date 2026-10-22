import { getLegacyTile, toLegacyTiles } from '../../src/adapters/legacy-tiles'
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

describe('when getting the legacy type code of a tile', () => {
  let tile: Partial<Tile>

  describe.each([
    [TileType.DISTRICT, 5],
    [TileType.ROAD, 7],
    [TileType.PLAZA, 8],
    [TileType.OWNED, 9],
    [TileType.UNOWNED, 11],
  ])('and the tile is of type %s', (type, code) => {
    beforeEach(() => {
      tile = { type }
    })

    it(`should return ${code}`, () => {
      expect(getLegacyTile(tile)).toBe(code)
    })
  })

  describe('and the tile is on sale', () => {
    beforeEach(() => {
      tile = { type: TileType.OWNED, price: 1500 }
    })

    it('should return the on sale code 10 regardless of its type', () => {
      expect(getLegacyTile(tile)).toBe(10)
    })
  })

  describe('and the tile has an unknown type', () => {
    beforeEach(() => {
      tile = { type: 'unknown' as TileType }
    })

    it('should return -1', () => {
      expect(getLegacyTile(tile)).toBe(-1)
    })
  })
})

describe('when converting a full tile into the legacy format', () => {
  let tile: Tile

  beforeEach(() => {
    tile = {
      id: '-3,4',
      x: -3,
      y: 4,
      type: TileType.OWNED,
      top: true,
      left: true,
      topLeft: true,
      updatedAt: 1000,
      name: 'An estate',
      owner: '0xowner',
      estateId: '12',
      tokenId: '1234',
      nftId: 'parcel-1234',
      price: 1500,
      expiresAt: 2000,
    }
  })

  it('should keep the coordinates, owner and name, rename the estate id, use numeric flags and the on sale code', () => {
    expect(toLegacyTiles({ [tile.id]: tile })).toEqual({
      [tile.id]: {
        type: 10,
        x: -3,
        y: 4,
        top: 1,
        left: 1,
        topLeft: 1,
        name: 'An estate',
        owner: '0xowner',
        estate_id: '12',
        price: 1500,
      },
    })
  })
})

describe('when converting a disconnected unowned tile into the legacy format', () => {
  let tile: Tile

  beforeEach(() => {
    tile = {
      id: '0,0',
      x: 0,
      y: 0,
      type: TileType.UNOWNED,
      top: false,
      left: false,
      topLeft: false,
      updatedAt: 1000,
    }
  })

  it('should keep the zero coordinates and omit the false flags', () => {
    expect(toLegacyTiles({ [tile.id]: tile })).toEqual({
      [tile.id]: { type: 11, x: 0, y: 0 },
    })
  })
})

describe('when converting tiles reduced to some fields into the legacy format', () => {
  let tiles: Record<string, Partial<Tile>>

  beforeEach(() => {
    tiles = { '1,1': { x: 1, y: 1 } }
  })

  it('should only output the fields present in the tile', () => {
    expect(toLegacyTiles(tiles)).toEqual({ '1,1': { x: 1, y: 1 } })
  })
})
