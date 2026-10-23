import { Tile } from '../modules/map/types'
import { PixelsRenderJob } from './render-pool'

export type MiniMapRendererComponent = {
  /** Builds the minimap pixels of the given tiles, e.g. from a map snapshot; the render pool encodes them. */
  getRenderJob(tiles: Record<string, Tile>): PixelsRenderJob
}

const DIMENSION = 512

function toRenderJob(data: Uint8ClampedArray): PixelsRenderJob {
  return {
    kind: 'pixels',
    width: DIMENSION,
    height: DIMENSION,
    data,
    compressionLevel: 5,
  }
}

/**
 * This minimap encodes information of districts and neighbours into the visible channels
 * RED = (top & 1) << 3 | (left & 1) << 4 | (topLeft & 1) << 5
 * GREEN = (isDistrict & 1) << 5 | (isRoad & 1) << 6 | (isOwned & 1) << 7
 * BLUE = 0
 */
export async function createMiniMapRendererComponent(): Promise<MiniMapRendererComponent> {
  const dimension = DIMENSION

  function getRenderJob(data: Record<string, Tile>) {
    // a fresh buffer per render, since it is transferred to the worker
    const pixels = new Uint8ClampedArray(dimension * dimension * 4)
    for (var pos in data) {
      const { x, y, top, left, topLeft, type } = data[pos]

      let flagsR = 0
      let flagsG = 0

      if (top) flagsR |= 8
      if (left) flagsR |= 16
      if (topLeft) flagsR |= 32

      switch (type) {
        case 'district': {
          flagsG = 32
          break
        }
        case 'road': {
          flagsG = 64
          break
        }
        case 'owned': {
          flagsG = 128
          break
        }
      }

      const absoluteY = dimension - (y + 256)
      const pointer = (x + 256 + absoluteY * dimension) * 4

      pixels[pointer] = flagsR
      pixels[pointer + 1] = flagsG
      pixels[pointer + 2] = 0
      pixels[pointer + 3] = 255
    }

    return toRenderJob(pixels)
  }

  return {
    getRenderJob,
  }
}

const TOKEN_ID_PATTERN = /^\d+$/

// token ids by numeric value, any other id after them in string order
function compareEstateIds(a: string, b: string): number {
  const aIsTokenId = TOKEN_ID_PATTERN.test(a)
  const bIsTokenId = TOKEN_ID_PATTERN.test(b)
  if (aIsTokenId && bIsTokenId) {
    return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
  }
  if (aIsTokenId !== bIsTokenId) {
    return aIsTokenId ? -1 : 1
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Numbers the estates by id, so every replica holding the same tiles draws the same image
 * however it stored them. Indexes are 1-based so 0 keeps meaning "no estate".
 */
function getEstateIndexes(tiles: Record<string, Tile>): Map<string, number> {
  const estateIds = new Set<string>()
  for (const id in tiles) {
    const { estateId } = tiles[id]
    if (estateId) {
      estateIds.add(estateId)
    }
  }
  return new Map(
    Array.from(estateIds)
      .sort(compareEstateIds)
      .map((estateId, i) => [estateId, i + 1])
  )
}

/**
 * This minimap encodes independent estates on the three visible color channels
 */
export async function createEstatesRendererComponent(): Promise<MiniMapRendererComponent> {
  const dimension = DIMENSION

  function getRenderJob(data: Record<string, Tile>) {
    // a fresh buffer per render, since it is transferred to the worker
    const pixels = new Uint8ClampedArray(dimension * dimension * 4)
    const estateIndexes = getEstateIndexes(data)

    for (var pos in data) {
      const { x, y, estateId } = data[pos]
      let flagsR = 0
      let flagsG = 0
      let flagsB = 0
      let index = estateId ? estateIndexes.get(estateId) ?? 0 : 0

      flagsB = index & 0xff
      index >>= 8
      flagsG = index & 0xff
      index >>= 8
      flagsR = index & 0xff
      index >>= 8

      const absoluteY = dimension - (y + 256)
      const pointer = (x + 256 + absoluteY * dimension) * 4

      pixels[pointer] = flagsR
      pixels[pointer + 1] = flagsG
      pixels[pointer + 2] = flagsB
      pixels[pointer + 3] = 255
    }

    return toRenderJob(pixels)
  }

  return {
    getRenderJob,
  }
}
