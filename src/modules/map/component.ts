import {
  IBaseComponent,
  IConfigComponent,
  IStatusCheckCapableComponent,
} from '@well-known-components/interfaces'
import { SingleBar } from 'cli-progress'
import { EventEmitter } from 'events'
import future from 'fp-future'
import { Estate } from '../../entity/Estate'
import { LastSync } from '../../entity/LastSync'
import { Parcel } from '../../entity/Parcel'
import { Tile as TileEntity } from '../../entity/Tile'
import { IApiComponent, NFT } from '../api/types'
import { IDatabaseComponent } from '../database/types'
import { IMapComponent, Tile, MapEvents } from './types'
import { addSpecialTiles, computeEstate, isExpired, sleep } from './utils'

export async function createMapComponent(components: {
  config: IConfigComponent
  database: IDatabaseComponent,
  api: IApiComponent
}): Promise<IMapComponent & IBaseComponent & IStatusCheckCapableComponent> {
  const { config, database, api } = components

  // config
  const refreshInterval =
    (await config.requireNumber('REFRESH_INTERVAL')) * 1000
  const landContractAddress = await config.requireString(
    'LAND_CONTRACT_ADDRESS'
  )
  const estateContractAddress = await config.requireString(
    'ESTATE_CONTRACT_ADDRESS'
  )

  // events
  const events = new EventEmitter()

  // data
  let tiles = future<Record<string, Tile>>()
  let parcels = future<Record<string, NFT>>()
  let estates = future<Record<string, NFT>>()
  let tokens = future<Record<string, NFT>>()
  let ready = false
  let lastUpdatedAt = 0

  // sort
  const sortByCoords = (a: Tile, b: Tile) =>
    a.x < b.x ? -1 : a.x > b.x ? 1 : a.y > b.y ? -1 : 1 // sort from left to right, from top to bottom

  // methods
  function addTiles(newTiles: Tile[], oldTiles: Record<string, Tile>) {
    // mutations ahead (for performance reasons)
    for (const tile of newTiles.sort(sortByCoords)) {
      oldTiles[tile.id] = tile
      computeEstate(tile.x, tile.y, oldTiles)
    }
    return oldTiles
  }

  function addParcels(newParcels: NFT[], oldParcels: Record<string, NFT>) {
    for (const parcel of newParcels) {
      const xAttr = parcel.attributes.find(
        (attribute) => attribute.trait_type === 'X'
      )
      const yAttr = parcel.attributes.find(
        (attribute) => attribute.trait_type === 'Y'
      )

      const x = xAttr ? xAttr.value : null
      const y = yAttr ? yAttr.value : null

      if (x !== null && y !== null) {
        const id = x + ',' + y
        oldParcels[id] = parcel
      }
    }

    return oldParcels
  }
  function addEstates(newEstates: NFT[], oldEstates: Record<string, NFT>) {
    for (const estate of newEstates) {
      oldEstates[estate.id] = estate
    }

    return oldEstates
  }
  function addTokens(
    newParcels: NFT[],
    newEstates: NFT[],
    oldTokens: Record<string, NFT>
  ) {
    for (const parcel of newParcels) {
      oldTokens[landContractAddress + '-' + parcel.id] = parcel
    }
    for (const estate of newEstates) {
      oldTokens[estateContractAddress + '-' + estate.id] = estate
    }

    return oldTokens
  }

  function expireOrders(tiles: Record<string, Tile>) {
    const newTiles: Record<string, Tile> = {}

    for (const id in tiles) {
      const tile = tiles[id]

      if (isExpired(tile)) {
        newTiles[id] = { ...tile }
        delete newTiles[id].price
        delete newTiles[id].expiresAt
      } else {
        newTiles[id] = tile
      }
    }

    return newTiles
  }

  const lifeCycle: IBaseComponent = {
    // IBaseComponent.start lifecycle
    async start() {
      events.emit(MapEvents.INIT)
      const lastSyncRepo = await database.appDataSource.getRepository(LastSync);
      let lastSync = await lastSyncRepo.findOneBy({ id: 1 });

      // continue to poll if it's synced
      if (lastSync !== null && lastSync.updatedAt > 0) {
        lastUpdatedAt = lastSync.updatedAt

        // turn into the poll loop
        poll()
      } else {
        console.log('Sync from beginning...')

        // add new last sync
        if (lastSync === null) {
          lastSync = new LastSync()
          lastSync.updatedAt = 0
          lastSyncRepo.save(lastSync)
        }

        // sync from the beginning
        try {
          const result = await api.fetchData()
          lastUpdatedAt = result.updatedAt
          lastSync.updatedAt = result.updatedAt
          lastSyncRepo.save(lastSync)

          const _tiles = addSpecialTiles(addTiles(result.tiles, {}))
          tiles.resolve(_tiles)
          await importTiles(_tiles)

          const _parcels = addParcels(result.parcels, {})
          parcels.resolve(_parcels)
          await importParcels(_parcels)

          const _estates = addEstates(result.estates, {})
          estates.resolve(_estates)
          await importEstates(_estates)

          const _tokens = addTokens(result.parcels, result.estates, {})
          tokens.resolve(_tokens)
          await importTokens(_tokens)

          ready = true
          events.emit(MapEvents.READY, result, _tiles, _parcels, _estates, _tokens)
          await sleep(refreshInterval)
          poll()
        } catch (error) {
          tiles.reject(error)
        }
      }
    },
  }

  const statusChecks: IStatusCheckCapableComponent = {
    /**
     * The first probe to run is the Startup probe.
     * When your app starts up, it might need to do a lot of work.
     * It might need to fetch data from remote services, load dlls
     * from plugins, who knows what else. During that process, your
     * app should either not respond to requests, or if it does, it
     * should return a status code of 400 or higher. Once the startup
     * process has finished, you can switch to returning a success
     * result (200) for the startup probe.
     *
     * IMPORTANT: This method should return as soon as possible, not wait for completion.
     * @public
     */
    async startupProbe() {
      return isReady()
    },
    /**
     * Readiness probes indicate whether your application is ready to
     * handle requests. It could be that your application is alive, but
     * that it just can't handle HTTP traffic. In that case, Kubernetes
     * won't kill the container, but it will stop sending it requests.
     * In practical terms, that means the pod is removed from an
     * associated service's "pool" of pods that are handling requests,
     * by marking the pod as "Unready".
     *
     * IMPORTANT: This method should return as soon as possible, not wait for completion.
     * @public
     */
    async readynessProbe() {
      return isReady()
    },
  }

  async function poll() {
    console.log("Polling...");

    try {
      const result = await api.fetchUpdatedData(lastUpdatedAt)
      if (result.tiles.length > 0) {
        // update tiles
        const oldTiles = await tiles
        const newTiles = expireOrders(addTiles(result.tiles, oldTiles))
        tiles = future()
        tiles.resolve(newTiles)

        // update parcels
        const oldParcels = await parcels
        const newParcels = addParcels(result.parcels, oldParcels)
        parcels = future()
        parcels.resolve(newParcels)

        // update estates
        const oldEstates = await estates
        const newEstates = addEstates(result.estates, oldEstates)
        estates = future()
        estates.resolve(newEstates)

        // update token
        const oldTokens = await tokens
        const newTokens = addTokens(result.parcels, result.estates, oldTokens)
        tokens = future()
        tokens.resolve(newTokens)

        // update lastUpdatedAt
        lastUpdatedAt = result.updatedAt
        const lastSyncRepo = await database.appDataSource.getRepository(LastSync);
        let lastSync = await lastSyncRepo.findOneBy({ id: 1 });
        lastSync.updatedAt = result.updatedAt
        lastSyncRepo.save(lastSync)

        events.emit(MapEvents.UPDATE, result)
      }
    } catch (e) {
      events.emit(MapEvents.ERROR, e)
    }

    await sleep(refreshInterval)
    poll()
  }

  async function importTiles(tiles: Record<string, Tile>) {
    const tileRepo = await database.appDataSource.getRepository(TileEntity)

    console.log("\nImporting tiles...")
    const bar = new SingleBar({ format: '[{bar}] {percentage}%' })
    bar.start(100, 0)
    const total = Object.entries(tiles).length
    let counter = 0

    for (const [_, _tile] of Object.entries(tiles)) {
      counter++

      let tile = await tileRepo.findOneBy({ id: _tile.id })
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
      const progress = (counter / total) * 100
      bar.update(progress)
    }
  }

  async function importParcels(parcels: Record<string, NFT>) {
    const parcelRepo = await database.appDataSource.getRepository(Parcel)
    
    console.log("\nImporting parcels...")
    const bar = new SingleBar({ format: '[{bar}] {percentage}%' })
    bar.start(100, 0)
    const total = Object.entries(parcels).length
    let counter = 0
    
    for (const [_, _parcel] of Object.entries(parcels)) {
      counter++
      let parcel = await parcelRepo.findOneBy({ id: _parcel.id })
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
      const progress = (counter / total) * 100
      bar.update(progress)
    }
  }

  async function importEstates(estates: Record<string, NFT>) {
    const estateRepo = await database.appDataSource.getRepository(Estate)
    
    console.log("\nImporting estates...")
    const bar = new SingleBar({ format: '[{bar}] {percentage}%' })
    bar.start(100, 0)
    const total = Object.entries(estates).length
    let counter = 0
    
    for (const [_, _estate] of Object.entries(estates)) {
      counter++
      let estate = await estateRepo.findOneBy({ id: _estate.id })
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
      const progress = (counter / total) * 100
      bar.update(progress)
    }
  }

  async function importTokens(tokens: Record<string, NFT>) {

  }

  function getTiles() {
    return tiles
  }

  async function getParcel(
    x: string | number,
    y: string | number
  ): Promise<NFT | null> {
    const id = x + ',' + y
    const result = (await parcels)[id]
    return result || null
  }

  async function getEstate(id: string): Promise<NFT | null> {
    const result = (await estates)[id]
    return result || null
  }

  async function getToken(
    contractAddress: string,
    tokenId: string
  ): Promise<NFT | null> {
    const id = contractAddress + '-' + tokenId
    const result = (await tokens)[id]
    return result || null
  }

  function isReady() {
    return ready
  }

  function getLastUpdatedAt() {
    return lastUpdatedAt
  }

  return {
    ...lifeCycle,
    ...statusChecks,
    events,
    getTiles,
    getParcel,
    getEstate,
    getToken,
    isReady,
    getLastUpdatedAt,
  }
}
