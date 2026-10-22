import { MapRenderJob } from '../../adapters/render-pool'
import { Coord } from '../render'

export interface IImageComponent {
  /**
   * Resolves the tiles of a map image into a render job for the render pool.
   * @returns the job, holding only the tiles inside the viewport.
   */
  getRenderJob(
    width: number,
    height: number,
    size: number,
    center: Coord,
    selected: Coord[],
    showOnSale: boolean,
    showListedForRent: boolean
  ): Promise<MapRenderJob>
}
