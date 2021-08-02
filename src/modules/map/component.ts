import {
  IBaseComponent,
  IConfigComponent,
  IStatusCheckCapableComponent,
} from '@well-known-components/interfaces'
import { EventEmitter } from 'events'
import future from 'fp-future'
import { IApiComponent, NFT } from '../api/types'
import { IMapComponent, Tile, MapEvents } from './types'
import { addSpecialTiles, computeEstate, isExpired, sleep } from './utils'

export async function createMapComponent(components: {
  config: IConfigComponent
  api: IApiComponent
}): Promise<IMapComponent & IBaseComponent & IStatusCheckCapableComponent> {
  const { config, api } = components

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
      try {
        const result = await api.fetchData()
        lastUpdatedAt = result.updatedAt
        tiles.resolve(addSpecialTiles(addTiles(result.tiles, {})))
        parcels.resolve(addParcels(result.parcels, {}))
        estates.resolve(addEstates(result.estates, {}))
        tokens.resolve(addTokens(result.parcels, result.estates, {}))
        ready = true
        events.emit(MapEvents.READY, result)
        await sleep(refreshInterval)
        poll()
      } catch (error) {
        tiles.reject(error)
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

        events.emit(MapEvents.UPDATE, result)
      }
    } catch (e) {
      events.emit(MapEvents.ERROR, e)
    }

    await sleep(refreshInterval)
    poll()
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
