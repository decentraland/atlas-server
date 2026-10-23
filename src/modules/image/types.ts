import { MapRenderJob } from '../../adapters/render-pool'
import { Tile } from '../map/types'
import { Coord } from '../render'

export interface IImageComponent {
  /**
   * Resolves the tiles of a map image into a render job for the render pool.
   * @param tiles - the tiles to draw, e.g. from a map snapshot; only read, never copied.
   * @returns the job, holding only the tiles inside the viewport.
   */
  getRenderJob(
    tiles: Record<string, Tile>,
    width: number,
    height: number,
    size: number,
    center: Coord,
    selected: Coord[],
    showOnSale: boolean,
    showListedForRent: boolean
  ): MapRenderJob
}
