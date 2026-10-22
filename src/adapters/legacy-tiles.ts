import { TileType, Tile, LegacyTile } from '../modules/map/types'

export class InvalidRentalPriceError extends Error {
  constructor(value: unknown) {
    super(`Invalid rental price per day: ${String(value)}`)
    this.name = 'InvalidRentalPriceError'
  }
}

// accepts the same inputs as ethers v5 BigNumber.from: decimal or 0x hex strings, optionally negative, or safe integers
function parseBigInt(value: string | number): bigint {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new InvalidRentalPriceError(value)
    }
    return BigInt(value)
  }
  const match =
    typeof value === 'string'
      ? value.match(/^(-?)(0x[0-9a-fA-F]+|[0-9]+)$/)
      : null
  if (!match) {
    throw new InvalidRentalPriceError(value)
  }
  const magnitude = BigInt(match[2])
  return match[1] ? -magnitude : magnitude
}

export function getLegacyTile(tile: Partial<Tile>): number {
  if (tile.price != null) {
    return 10
  }
  switch (tile.type) {
    case TileType.DISTRICT:
      return 5
    case TileType.OWNED:
      return 9
    case TileType.UNOWNED:
      return 11
    case TileType.PLAZA:
      return 8
    case TileType.ROAD:
      return 7
    default:
      return -1
  }
}

// helpers to convert to legacy format
export function toLegacyTiles(tiles: Record<string, Partial<Tile>>) {
  const legacyTiles: Record<string, Partial<LegacyTile>> = {}
  for (const id in tiles) {
    legacyTiles[id] = toLegacyTile(tiles[id])
  }
  return legacyTiles
}

function toLegacyTile(tile: Partial<Tile>): Partial<LegacyTile> {
  const legacyTile: Partial<LegacyTile> = {}
  if (tile.type) legacyTile.type = getLegacyTile(tile)
  if ('x' in tile) legacyTile.x = tile.x
  if ('y' in tile) legacyTile.y = tile.y
  if (tile.top) legacyTile.top = 1
  if (tile.left) legacyTile.left = 1
  if (tile.topLeft) legacyTile.topLeft = 1
  if (tile.owner) legacyTile.owner = tile.owner
  if (tile.name) legacyTile.name = tile.name
  if (tile.estateId) legacyTile.estate_id = tile.estateId
  if (tile.price) legacyTile.price = tile.price
  if (tile.rentalListing)
    legacyTile.rentalPricePerDay = tile.rentalListing.periods.reduce(
      (acc, curr) =>
        parseBigInt(curr.pricePerDay) > parseBigInt(acc)
          ? curr.pricePerDay
          : acc,
      '0'
    )

  return legacyTile
}
