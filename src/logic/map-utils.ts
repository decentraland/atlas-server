import { SpecialTile, Tile, TileType } from '../ports/map/types'
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

// helper to convert a "special tile" into a Tile. A "special tile" is a road, a plaza or a district
function fromSpecialTile(specialTile: SpecialTile): Tile {
  const [x, y] = idToCoords(specialTile.id)
  const name = specialTile.type[0].toUpperCase() + specialTile.type.slice(1)
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
    tiles[specialTile.id] = fromSpecialTile(specialTile)
  }
  return tiles
}

// sort
const sortByCoords = (a: Tile, b: Tile) =>
  a.x < b.x ? -1 : a.x > b.x ? 1 : a.y > b.y ? -1 : 1 // sort from left to right, from top to bottom

// returns the max lastUpdatedAt and the mutated tiles
export function addTiles(
  newTiles: Tile[],
  oldTiles: Record<string, Tile>,
  lastUpdatedAt: number
) {
  // mutations ahead (for performance reasons)
  for (const tile of newTiles.sort(sortByCoords)) {
    oldTiles[tile.id] = tile
    lastUpdatedAt = Math.max(lastUpdatedAt, tile.updatedAt)
    computeEstate(tile.x, tile.y, oldTiles)
  }
  return {
    lastUpdatedAt,
    tiles: oldTiles,
  }
}
