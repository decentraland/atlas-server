import { EventEmitter } from 'events'
import future from 'fp-future'
import { IApiComponent, NFT } from '../api/types'
import { IConfigComponent } from '../config/types'
import { IMapComponent, Tile, MapEvents, MapConfig } from './types'
import { addSpecialTiles, computeEstate } from './utils'

export function createMapComponent(components: {
  config: IConfigComponent<MapConfig>
  api: IApiComponent
}): IMapComponent {
  const { config, api } = components

  // config
  const refreshInterval = config.getNumber('REFRESH_INTERVAL') * 1000
  const landContractAddress = config.getString('LAND_CONTRACT_ADDRESS')
  const estateContractAddress = config.getString('ESTATE_CONTRACT_ADDRESS')

  // events
  const events = new EventEmitter()

  // data
  let tiles = future<Record<string, Tile>>()
  let parcels = future<Record<string, NFT>>()
  let estates = future<Record<string, NFT>>()
  let tokens = future<Record<string, NFT>>()
  let inited = false
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

  function init() {
    if (!inited) {
      api
        .fetchData()
        .then((result) => {
          lastUpdatedAt = result.updatedAt
          tiles.resolve(addSpecialTiles(addTiles(result.tiles, {})))
          parcels.resolve(addParcels(result.parcels, {}))
          estates.resolve(addEstates(result.estates, {}))
          tokens.resolve(addTokens(result.parcels, result.estates, {}))
          setTimeout(poll, refreshInterval)
          events.emit(MapEvents.READY, result)
        })
        .catch((error) => {
          inited = false
          tiles.reject(error)
          events.emit(MapEvents.ERROR, error)
        })
      inited = true
      events.emit(MapEvents.INIT)
    }
  }

  async function poll() {
    const result = await api.fetchUpdatedData(lastUpdatedAt)
    if (result.tiles.length > 0) {
      // update tiles
      const oldTiles = await tiles
      const newTiles = addTiles(result.tiles, oldTiles)
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
    setTimeout(poll, refreshInterval)
  }

  function getTiles() {
    init()
    return tiles
  }

  async function getParcel(
    x: string | number,
    y: string | number
  ): Promise<NFT | null> {
    init()
    const id = x + ',' + y
    const result = (await parcels)[id]
    return result || null
  }

  async function getEstate(id: string): Promise<NFT | null> {
    init()
    const result = (await estates)[id]
    return result || null
  }

  async function getToken(
    contractAddress: string,
    tokenId: string
  ): Promise<NFT | null> {
    init()
    const id = contractAddress + '-' + tokenId
    const result = (await tokens)[id]
    return result || null
  }

  function getLastUpdatedAt() {
    return lastUpdatedAt
  }

  return {
    events,
    init,
    getTiles,
    getParcel,
    getEstate,
    getToken,
    getLastUpdatedAt,
  }
}
