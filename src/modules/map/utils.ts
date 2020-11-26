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

export function getBounds(tiles: Record<string, Tile>) {
  const keys = Object.keys(tiles)
  const bounds = keys.reduce(
    (bounds, key) => {
      const [x, y] = idToCoords(key)
      if (x < bounds.minX) bounds.minX = x
      if (x > bounds.maxX) bounds.maxX = x
      if (y < bounds.minY) bounds.minY = y
      if (y > bounds.maxY) bounds.maxY = y
      return bounds
    },
    { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  )
  return bounds
}

// watch out! this method performs mutations
export function computeEstates(tiles: Record<string, Tile>) {
  // get bounds
  const bounds = getBounds(tiles)

  // loop within bounds
  for (let x = bounds.minX; x <= bounds.maxX; x++) {
    for (let y = bounds.minY; y <= bounds.maxY; y++) {
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
        tile.topLeft = topLeftTile
          ? topLeftTile.estateId === tile.estateId
          : false
      }
    }
  }

  return tiles
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
    owner: null,
    estateId: null,
    tokenId: null,
    price: null,
    updatedAt: Date.now(),
  }
}
export function addSpecialTiles(tiles: Record<string, Tile>) {
  for (const specialTile of Object.values(specialTiles)) {
    tiles[specialTile.id] = fromSpecialTile(specialTile)
  }
  return tiles
}
