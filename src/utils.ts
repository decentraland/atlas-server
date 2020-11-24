import { TileType } from './types'

export const SEPARATOR = ','

export function coordsToId(x: number, y: number) {
  return x + SEPARATOR + y
}

export function idToCoords(id: string) {
  return id.split(SEPARATOR).map((coord) => parseInt(coord, 10))
}

export const toLegacyType = (type: TileType) => {
  return 0
}
