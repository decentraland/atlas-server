import { LegacyTile, SpecialTile, Tile, TileType } from './types'
import specialTilesJson from './data/specialTiles.json'

export const specialTiles = specialTilesJson as Record<string, SpecialTile>

export const SEPARATOR = ','

export function coordsToId(x: number, y: number) {
  return x + SEPARATOR + y
}

export function idToCoords(id: string) {
  return id.split(SEPARATOR).map((coord) => parseInt(coord, 10))
}

type EstateFlags = Pick<Tile, 'top' | 'left' | 'topLeft'>

/** Gets the flags stitching the tile at x,y to its estate neighbours, or null if it isn't in an estate. */
export function getEstateFlags(
  x: number,
  y: number,
  tiles: Record<string, Tile>
): EstateFlags | null {
  const tile = tiles[coordsToId(x, y)]
  if (!tile || tile.type !== TileType.OWNED || !tile.estateId) {
    return null
  }
  const topTile = tiles[coordsToId(x, y + 1)]
  const leftTile = tiles[coordsToId(x - 1, y)]
  const topLeftTile = tiles[coordsToId(x - 1, y + 1)]
  return {
    top: topTile ? topTile.estateId === tile.estateId : false,
    left: leftTile ? leftTile.estateId === tile.estateId : false,
    topLeft: topLeftTile ? topLeftTile.estateId === tile.estateId : false,
  }
}

export function computeEstate(
  x: number,
  y: number,
  tiles: Record<string, Tile>
) {
  const flags = getEstateFlags(x, y, tiles)
  if (flags) {
    // mutations ahead! we are mutating here because it's way faster than recreating thousands of objects
    Object.assign(tiles[coordsToId(x, y)], flags)
  }
}

/** Gets the ids of the tiles whose estate flags depend on the tile at x,y, itself included. */
export function getEstateDependentIds(x: number, y: number): string[] {
  return [
    coordsToId(x, y),
    coordsToId(x + 1, y),
    coordsToId(x, y - 1),
    coordsToId(x + 1, y - 1),
  ]
}

// helper to convert a "special tile" into a Tile. A "special tile" is a road, a plaza or a district
function fromSpecialTile(specialTile: SpecialTile): Tile {
  const [x, y] = idToCoords(specialTile.id)
  const name =
    specialTile.name ||
    specialTile.type[0].toUpperCase() + specialTile.type.slice(1)
  return {
    ...specialTile,
    x,
    y,
    name,
    updatedAt: Date.now(),
  }
}
export function addSpecialTiles(tiles: Record<string, Tile>) {
  for (const specialTile of Object.values(specialTiles)) {
    tiles[specialTile.id] =
      specialTile.id in tiles
        ? tiles[specialTile.id]
        : fromSpecialTile(specialTile)
  }
  return tiles
}

export function isExpired(tile: Tile) {
  return tile && tile.expiresAt && tile.expiresAt <= Date.now() / 1000
}

export async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
