import { createCanvas } from 'canvas'
import { Readable } from 'stream'
import { IMapComponent } from '../modules/map/types'

export type MiniMapRendererComponent = {
  getStream(): Promise<Readable>
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
  const dimension = 512
  const canvas = createCanvas(dimension, dimension)
  const ctx = canvas.getContext('2d')

  const picture = ctx.createImageData(dimension, dimension)

  async function getStream() {
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

      picture.data[pointer] = flagsR
      picture.data[pointer + 1] = flagsG
      picture.data[pointer + 2] = 0
      picture.data[pointer + 3] = 255
    }

    ctx.putImageData(picture, 0, 0)

    return canvas.createPNGStream({ compressionLevel: 5 })
  }

  return {
    getStream,
  }
}

/**
 * This minimap encodes independent estates on the three visible color channels
 */
export async function createEstatesRendererComponent(components: {
  map: IMapComponent
}): Promise<MiniMapRendererComponent> {
  const dimension = 512
  const canvas = createCanvas(dimension, dimension)
  const ctx = canvas.getContext('2d')

  const picture = ctx.createImageData(dimension, dimension)

  async function getStream() {
    const data = await components.map.getTiles()
    const array: string[] = []

    for (var pos in data) {
      const { x, y, estateId } = data[pos]
      let flagsR = 0
      let flagsG = 0
      let flagsB = 0
      let index = 0

      if (estateId) {
        if (array.includes(estateId)) {
          index = array.indexOf(estateId)
        } else {
          index = array.push(estateId)
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

      picture.data[pointer] = flagsR
      picture.data[pointer + 1] = flagsG
      picture.data[pointer + 2] = flagsB
      picture.data[pointer + 3] = 255
    }

    ctx.putImageData(picture, 0, 0)

    return canvas.createPNGStream({ compressionLevel: 5 })
  }

  return {
    getStream,
  }
}
