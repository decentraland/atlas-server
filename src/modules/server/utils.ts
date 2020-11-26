import { Request, Response } from 'express'
import { Tile, TileType } from '../map/types'
import { LegacyTile } from './types'

// helper to use async handlers
export function handle<T>(
  handler: (req: Request, res: Response) => Promise<T>
) {
  return (req: Request, res: Response) => {
    handler(req, res)
      .then((data) => res.json({ ok: true, data }))
      .catch((error) => res.status(500).send({ ok: false, error }))
  }
}

// helpers to convert to legacy format
export function toLegacyTiles(tiles: Record<string, Tile>) {
  const legacyTiles: Record<string, LegacyTile> = {}
  for (const tile of Object.values(tiles)) {
    legacyTiles[tile.id] = toLegacyTile(tile)
  }
  return legacyTiles
}

export function toLegacyTile(tile: Tile): LegacyTile {
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

export function getLegacyTile(tile: Tile): number {
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
