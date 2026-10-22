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

export function computeEstate(
  x: number,
  y: number,
  tiles: Record<string, Tile>
) {
  const id = coordsToId(x, y)
  const tile = tiles[id]
  if (tile && tile.type === TileType.OWNED && tile.estateId) {
    // stitch tiles together if they belong to the same estate
    const topId = coordsToId(x, y + 1)
    const leftId = coordsToId(x - 1, y)
    const topLeftId = coordsToId(x - 1, y + 1)

    const topTile = tiles[topId]
    const leftTile = tiles[leftId]
    const topLeftTile = tiles[topLeftId]

    // mutations ahead! we are mutating here because it's way faster than recreating thousands of objects
    tile.top = topTile ? topTile.estateId === tile.estateId : false
    tile.left = leftTile ? leftTile.estateId === tile.estateId : false
    tile.topLeft = topLeftTile ? topLeftTile.estateId === tile.estateId : false
  }
}

// helper to convert a "special tile" into a Tile. A "special tile" is a road or a plaza
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
    tiles[specialTile.id] = specialTile.id in tiles
      ? tiles[specialTile.id]
      : fromSpecialTile(specialTile)
  }
  return tiles
}

const specialTileTypes = new Set<TileType>([
  TileType.PLAZA,
  TileType.ROAD,
  TileType.DISTRICT,
])

// true when a tile disagrees with the current specialTiles data
export function hasStaleSpecialTiles(tiles: Tile[]): boolean {
  return tiles.some((tile) => {
    if (!(tile.id in specialTiles)) {
      return specialTileTypes.has(tile.type)
    }
    const specialTile = specialTiles[tile.id]
    return (
      tile.type !== specialTile.type ||
      tile.top !== specialTile.top ||
      tile.left !== specialTile.left ||
      tile.topLeft !== specialTile.topLeft
    )
  })
}

export function isExpired(tile: Tile) {
  return tile && tile.expiresAt && tile.expiresAt <= (Date.now() / 1000)
}

export async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}