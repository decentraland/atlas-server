import { SpecialTile, Tile, TileType } from './types'
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
