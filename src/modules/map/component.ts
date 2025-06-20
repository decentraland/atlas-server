import {
  IBaseComponent,
  IStatusCheckCapableComponent,
} from '@well-known-components/interfaces'
import { EventEmitter } from 'events'
import future from 'fp-future'
import { NFT, Result } from '../api/types'
import { IMapComponent, Tile, MapEvents } from './types'
import { addSpecialTiles, computeEstate, isExpired, sleep } from './utils'
import { toLegacyTiles } from '../../adapters/legacy-tiles'
import { AppComponents } from '../../types'

export async function createMapComponent(
  components: Pick<
    AppComponents,
    'config' | 'api' | 'batchApi' | 'tracer' | 's3' | 'logs' | 'trades'
  >
): Promise<IMapComponent & IBaseComponent & IStatusCheckCapableComponent> {
  const { config, api, batchApi, tracer, s3, logs, trades } = components
  const componentLogger = logs.getLogger('Map component')

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
  let lastUpdatedAt = 0 // in ms
  let lastUploadedTilesUrl: { v1?: string; v2?: string } = {}

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

  async function uploadTilesToS3(tilesData: Record<string, Tile>) {
    try {
      componentLogger.info('Starting tiles upload to S3...')

      // Upload v1 format (legacy)
      lastUploadedTilesUrl.v1 = await s3.uploadTilesJson(
        'v1',
        toLegacyTiles(tilesData)
      )
      componentLogger.info(`Uploaded v1 tiles to ${lastUploadedTilesUrl.v1}`)

      // Upload v2 format (current)
      lastUploadedTilesUrl.v2 = await s3.uploadTilesJson('v2', tilesData)
      componentLogger.info(`Uploaded v2 tiles to ${lastUploadedTilesUrl.v2}`)

      // Upload timestamp separately
      await s3.uploadTimestamp(lastUpdatedAt)
      componentLogger.info(`Uploaded timestamp to S3`)
    } catch (error) {
      componentLogger.warn(
        `Failed to upload tiles to S3 (will serve from memory): ${error}`
      )
      events.emit(
        MapEvents.ERROR,
        new Error(`Failed to upload tiles to S3: ${error}`)
      )
    }
  }

  async function updateTilesWithTrades(tiles: Record<string, Tile>) {
    try {
      const activeTrades = await trades.getActiveTrades()
      const newTiles = { ...tiles }

      for (const trade of activeTrades) {
        // Find tiles that match the trade's contract and token
        const matchingTiles = Object.values(newTiles).filter((tile) => {
          const matches =
            tile.nftId &&
            tile.tokenId &&
            trade.contract_address_sent &&
            trade.sent_token_id &&
            ((!tile.estateId &&
              tile.nftId.includes(trade.contract_address_sent) &&
              tile.tokenId === trade.sent_token_id) ||
              (tile.estateId && tile.estateId === trade.sent_token_id))

          return matches
        })

        for (const tile of matchingTiles) {
          const tradeCreatedAt = new Date(trade.created_at).getTime()
          const tradePrice = Math.round(parseInt(trade.amount_received) / 1e18)

          // If tile has no price or trade is more recent than current order
          if (
            !tile.price ||
            (tile.updatedAt && tradeCreatedAt > tile.updatedAt)
          ) {
            componentLogger.info(
              `Updating tile ${tile.id} price from ${tile.price} to ${tradePrice}`
            )
            newTiles[tile.id] = {
              ...tile,
              price: tradePrice,
              updatedAt: tradeCreatedAt,
            }
          }
        }
      }

      return newTiles
    } catch (error) {
      componentLogger.error(`Failed to update tiles with trades: ${error}`)
      return tiles
    }
  }

  const lifeCycle: IBaseComponent = {
    // IBaseComponent.start lifecycle
    async start() {
      events.emit(MapEvents.INIT)
      try {
        // Try to load cached tiles and timestamp from S3
        const [cachedTiles, cachedTimestamp] = await Promise.all([
          s3.getTilesJson('v2'),
          s3.getTimestamp(),
        ])

        if (cachedTiles && cachedTimestamp) {
          componentLogger.info(
            'Found cached tiles in S3, using them to initialize the component'
          )
          lastUpdatedAt = cachedTimestamp
          const newTiles = addSpecialTiles(
            addTiles(Object.values(cachedTiles), {})
          )
          tiles.resolve(newTiles)

          // Set the lastUploadedTilesUrl when loading from cache
          lastUploadedTilesUrl = {
            v1: await s3.getFileUrl('v1'),
            v2: await s3.getFileUrl('v2'),
          }

          // Fetch only the necessary data for parcels and estates
          const result = await batchApi.fetchData()
          parcels.resolve(addParcels(result.parcels, {}))
          estates.resolve(addEstates(result.estates, {}))
          tokens.resolve(addTokens(result.parcels, result.estates, {}))

          // After initializing tiles, update them with trades
          const initialTiles = await tiles
          const tilesWithTrades = await updateTilesWithTrades(initialTiles)
          tiles = future()
          tiles.resolve(tilesWithTrades)

          ready = true
          await uploadTilesToS3(tilesWithTrades)
          events.emit(MapEvents.READY, {
            tiles: Object.values(tilesWithTrades),
            parcels: result.parcels,
            estates: result.estates,
            updatedAt: lastUpdatedAt,
          })
        } else {
          // Fallback to original initialization if no cache exists
          componentLogger.info(
            'No cached tiles found in S3, fetching fresh data'
          )
          const result = await batchApi.fetchData()
          lastUpdatedAt = result.updatedAt
          const newTiles = addSpecialTiles(addTiles(result.tiles, {}))
          tiles.resolve(newTiles)
          parcels.resolve(addParcels(result.parcels, {}))
          estates.resolve(addEstates(result.estates, {}))
          tokens.resolve(addTokens(result.parcels, result.estates, {}))

          // After initializing tiles, update them with trades
          const initialTiles = await tiles
          const tilesWithTrades = await updateTilesWithTrades(initialTiles)
          tiles = future()
          tiles.resolve(tilesWithTrades)

          ready = true
          await uploadTilesToS3(tilesWithTrades)
          events.emit(MapEvents.READY, {
            tiles: Object.values(tilesWithTrades),
            parcels: result.parcels,
            estates: result.estates,
            updatedAt: lastUpdatedAt,
          })
        }

        await sleep(refreshInterval)
        poll()
      } catch (error) {
        componentLogger.error(`Failed to initialize map component: ${error}`)
        tiles.reject(error as Error)
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
    while (true) {
      await tracer.span('Polling loop', async () => {
        try {
          const oldTiles = await tiles
          const oldParcels = await parcels
          const oldEstates = await estates

          const result = await api.fetchUpdatedData(lastUpdatedAt, oldTiles)
          if (result.tiles.length > 0) {
            // update tiles
            const newTiles = expireOrders(addTiles(result.tiles, oldTiles))
            // Add trade prices
            const tilesWithTrades = await updateTilesWithTrades(newTiles)
            tiles = future()
            tiles.resolve(tilesWithTrades)

            // update parcels
            const newParcels = addParcels(result.parcels, oldParcels)
            parcels = future()
            parcels.resolve(newParcels)

            // update estates
            const newEstates = addEstates(result.estates, oldEstates)
            estates = future()
            estates.resolve(newEstates)

            // update token
            const oldTokens = await tokens
            const newTokens = addTokens(
              result.parcels,
              result.estates,
              oldTokens
            )
            tokens = future()
            tokens.resolve(newTokens)

            // update lastUpdatedAt
            lastUpdatedAt = result.updatedAt

            // upload new tiles to S3
            await uploadTilesToS3(tilesWithTrades)

            events.emit(MapEvents.UPDATE, result)
          }
        } catch (error) {
          events.emit(MapEvents.ERROR, error)
        }

        await sleep(refreshInterval)
      })
    }
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

  async function getLastEstateId() {
    const ids = Object.values(await estates)
      .map((estate) => Number(estate.id))
      .sort((a, b) => (a > b ? 1 : -1))
    return ids.pop()!
  }

  const notFoundDissolvedEstateIds = new Set<string>()
  async function getDissolvedEstate(id: string) {
    // if id is not a tokenId
    if (id && !id.match(`^[0-9]+$`)) {
      return null
    }

    // if this id has been queried already return before hitting the subgraph
    if (notFoundDissolvedEstateIds.has(id)) {
      return null
    }
    // if id goes beyond last id in memory return before hitting the subgraph
    const lastEstateId = await getLastEstateId()
    if (Number(id) > lastEstateId) {
      return null
    }
    // fetch dissolved estate from subgraph
    const estate = await api.getDissolvedEstate(id)
    if (estate) {
      // update estates with the dissolved estate for future requests
      const result: Result = {
        tiles: [],
        parcels: [],
        estates: [estate],
        updatedAt: lastUpdatedAt, // we keep the lastUpdatedAt when inserting a dissolved estate since this is added on demand
      }
      const oldEstates = await estates
      const newEstates = addEstates(result.estates, oldEstates)
      estates = future()
      estates.resolve(newEstates)
      events.emit(MapEvents.UPDATE, result)
    } else {
      // keep track of ids that don't exist
      notFoundDissolvedEstateIds.add(id)
    }

    return estate
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
    getDissolvedEstate,
    getToken,
    isReady,
    getLastUpdatedAt,
    getLastUploadedTilesUrl: () => lastUploadedTilesUrl,
  }
}
