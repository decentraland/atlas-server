import { createCanvas, loadImage } from 'canvas'
import { Readable } from 'stream'

export async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Decodes a PNG and returns a reader of its RGBA pixels. */
export async function decodePng(
  png: Buffer
): Promise<(x: number, y: number) => number[]> {
  const image = await loadImage(png)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, image.width, image.height)
  return (x, y) => {
    const offset = (y * image.width + x) * 4
    return Array.from(data.slice(offset, offset + 4))
  }
}
