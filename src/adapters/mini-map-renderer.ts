import { IMapComponent } from '../modules/map/types'
import { PixelsRenderJob } from './render-pool'

export type MiniMapRendererComponent = {
  /** Builds the minimap pixels; the render pool encodes them. */
  getRenderJob(): Promise<PixelsRenderJob>
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
export async function createMiniMapRendererComponent(components: {
  map: IMapComponent
}): Promise<MiniMapRendererComponent> {
  const dimension = DIMENSION

  async function getRenderJob() {
    // a fresh buffer per render, since it is transferred to the worker
    const pixels = new Uint8ClampedArray(dimension * dimension * 4)
    const data = await components.map.getTiles()
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

/**
 * This minimap encodes independent estates on the three visible color channels
 */
export async function createEstatesRendererComponent(components: {
  map: IMapComponent
}): Promise<MiniMapRendererComponent> {
  const dimension = DIMENSION

  async function getRenderJob() {
    // a fresh buffer per render, since it is transferred to the worker
    const pixels = new Uint8ClampedArray(dimension * dimension * 4)
    const data = await components.map.getTiles()
    // 1-based so 0 keeps meaning "no estate"
    const estateIndexes = new Map<string, number>()

    for (var pos in data) {
      const { x, y, estateId } = data[pos]
      let flagsR = 0
      let flagsG = 0
      let flagsB = 0
      let index = 0

      if (estateId) {
        const existing = estateIndexes.get(estateId)
        if (existing === undefined) {
          index = estateIndexes.size + 1
          estateIndexes.set(estateId, index)
        } else {
          index = existing
        }
      }

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
