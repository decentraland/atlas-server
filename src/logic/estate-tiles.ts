import { Tile } from '../modules/map/types'

const estatesByTiles = new WeakMap<Record<string, Tile>, Map<string, Tile[]>>()

/**
 * Finds the tiles of an estate. The tiles are indexed by estate once per tiles record, so
 * requests between two map updates don't scan the whole map.
 * @param tiles - the tiles the map serves; a new record replaces the index.
 * @param estateId - the estate.
 * @returns its tiles, empty when the estate has none, e.g. when it was dissolved.
 */
export function getEstateTiles(
  tiles: Record<string, Tile>,
  estateId: string
): Tile[] {
  let estates = estatesByTiles.get(tiles)
  if (!estates) {
    estates = new Map()
    for (const tile of Object.values(tiles)) {
      if (tile.estateId) {
        const estateTiles = estates.get(tile.estateId)
        if (estateTiles) {
          estateTiles.push(tile)
        } else {
          estates.set(tile.estateId, [tile])
        }
      }
    }
    estatesByTiles.set(tiles, estates)
  }
  return estates.get(estateId) ?? []
}
