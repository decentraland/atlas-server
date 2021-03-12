import { PNGStream } from 'canvas'
import { Coord } from '../render'

export interface IImageComponent {
  getStream(
    width: number,
    height: number,
    size: number,
    center: Coord,
    selected: Coord[],
    showOnSale: boolean
  ): Promise<PNGStream>
}
