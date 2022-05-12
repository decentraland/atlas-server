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

  map.events.on(MapEvents.READY, async (
    result: Result,
    tiles: Record<string, Tile>,
    parcels: Record<string, NFT>,
    estates: Record<string, NFT>,
    tokens: Record<string, NFT>
  ) => {
    console.log('stores - ready');
    const tileRepo = await database.appDataSource.getRepository(TileEntity)
    for (const [_, _tile] of Object.entries(tiles)) {
      let tile = await tileRepo.findOneBy({ id: _tile.id})
      if (tile === null) {
        // create new
        tile = new TileEntity()
      }
      // update
      tile.id = _tile.id
      tile.x = _tile.x
      tile.y = _tile.y
      tile.type = _tile.type
      tile.top = _tile.top
      tile.left = _tile.left
      tile.topLeft = _tile.topLeft
      tile.updatedAt = _tile.updatedAt
      tile.name = _tile.name
      tile.owner = _tile.owner
      tile.estateId = _tile.estateId
      tile.tokenId = _tile.tokenId
      tile.price = _tile.price?.toString()
      tile.expiresAt = _tile.expiresAt?.toString()
      await tileRepo.save(tile)
    }

    const parcelRepo = await database.appDataSource.getRepository(Parcel)
    for (const [_, _parcel] of Object.entries(parcels)) {
      let parcel = await parcelRepo.findOneBy({ id: _parcel.id})
      if (parcel === null) {
        // create new
        parcel = new Parcel()
      }
      // update
      parcel.id = _parcel.id
      parcel.name = _parcel.name
      parcel.description = _parcel.description
      parcel.image = _parcel.image
      parcel.external_url = _parcel.external_url
      parcel.background_color = _parcel.background_color
      parcel.attributes = _parcel.attributes
      await parcelRepo.save(parcel)
    }

    const estateRepo = await database.appDataSource.getRepository(Estate)
    for (const [_, _estate] of Object.entries(estates)) {
      let estate = await estateRepo.findOneBy({ id: _estate.id})
      if (estate === null) {
        // create new
        estate = new Estate()
      }
      // update
      estate.id = _estate.id
      estate.name = _estate.name
      estate.description = _estate.description
      estate.image = _estate.image
      estate.external_url = _estate.external_url
      estate.background_color = _estate.background_color
      estate.attributes = _estate.attributes
      await estateRepo.save(estate)
    }
  })

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
