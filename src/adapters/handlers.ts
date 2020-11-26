import { LegacyTile, Tile, TileType } from '../modules/map/types'
import { IRequestHandler } from '../modules/server/types'
import { AppComponents } from '../types'

export const createTilesRequestHandler = (
  components: Pick<AppComponents, 'map'>
): IRequestHandler<Record<string, Tile>> => {
  const { map } = components
  return async () => {
    const tiles = await map.getTiles()
    return {
      status: 200,
      body: tiles,
    }
  }
}

export const createLegacyTilesRequestHandler = (
  components: Pick<AppComponents, 'map'>
): IRequestHandler<Record<string, LegacyTile>> => {
  const { map } = components
  return async () => {
    const tiles = await map.getTiles()
    return {
      status: 200,
      body: toLegacyTiles(tiles),
    }
  }
}

// helpers to convert to legacy format
function toLegacyTiles(tiles: Record<string, Tile>) {
  const legacyTiles: Record<string, LegacyTile> = {}
  for (const tile of Object.values(tiles)) {
    legacyTiles[tile.id] = toLegacyTile(tile)
  }
  return legacyTiles
}

function toLegacyTile(tile: Tile): LegacyTile {
  const legacyTile: LegacyTile = {
    type: getLegacyTile(tile),
    x: tile.x,
    y: tile.y,
  }
  if (tile.top) legacyTile.top = 1
  if (tile.left) legacyTile.left = 1
  if (tile.topLeft) legacyTile.topLeft = 1
  if (tile.owner) legacyTile.owner = tile.owner
  if (tile.name) legacyTile.name = tile.name
  if (tile.estateId) legacyTile.estate_id = tile.estateId
  if (tile.price) legacyTile.price = tile.price

  return legacyTile
}

function getLegacyTile(tile: Tile): number {
  if (tile.price !== null) {
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
