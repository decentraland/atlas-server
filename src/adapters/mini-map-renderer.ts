import { createCanvas } from 'canvas'
import { Readable } from 'stream'
import { IMapComponent } from '../modules/map/types'

export type MiniMapRendererComponent = {
  getStream(): Promise<Readable>
}

export async function createMiniMapRendererComponent(components: {
  map: IMapComponent
}): Promise<MiniMapRendererComponent> {
  const dimension = 512
  const canvas = createCanvas(dimension, dimension)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D

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
