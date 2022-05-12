import { Estate } from '../entity/Estate'
import { Parcel } from '../entity/Parcel'
import { Tile as TileEntity } from '../entity/Tile'
import { NFT, Result } from '../modules/api/types'
import { MapEvents, Tile } from '../modules/map/types'
import { AppComponents } from '../types'

export const setupStores = (
  components: Pick<AppComponents, 'database' | 'map'>
) => {
  const { database, map } = components

  map.events.on(MapEvents.UPDATE, async (result: Result) => {
    console.log('stores - update');
  })

  map.events.on(MapEvents.ERROR, (error: Error) => {
    console.log(
      `Error: updating tiles
       ${error.message}
       ${error.stack}`
    )
  })
}
