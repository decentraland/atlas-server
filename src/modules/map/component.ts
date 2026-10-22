import {
  IBaseComponent,
  IStatusCheckCapableComponent,
} from '@well-known-components/interfaces'
import { EventEmitter } from 'events'
import future from 'fp-future'
import { NFT, Result } from '../api/types'
import { IMapComponent, Tile, MapEvents } from './types'
import {
  addSpecialTiles,
  computeEstate,
  hasStaleSpecialTiles,
  isExpired,
} from './utils'
import { toLegacyTiles } from '../../adapters/legacy-tiles'
import { Trade } from '../trades/component'
import { AppComponents } from '../../types'

// bump to discard tiles cached in S3 by an incompatible version
const TILES_CACHE_VERSION = 2

type TradePrice = {
  tile: Tile
  replaced: Pick<Tile, 'price' | 'expiresAt' | 'updatedAt'>
}

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
  let stopped = false
  const pendingSleeps = new Map<NodeJS.Timeout, () => void>()
  // tiles currently priced by a trade and the order price each one replaced
  let tradePrices = new Map<string, TradePrice>()
  let lastUpdatedAt = 0 // subgraph cursor, in ms
  let dataUpdatedAt = 0 // last change to the served data, in ms
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
      await s3.uploadTimestamp(lastUpdatedAt, TILES_CACHE_VERSION)
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

  // resolves early when the component stops
  function sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        pendingSleeps.delete(timer)
        resolve()
      }, ms)
      pendingSleeps.set(timer, resolve)
    })
  }

  function addToIndex<T>(index: Map<string, T[]>, key: string, value: T) {
    const values = index.get(key)
    if (values) {
      values.push(value)
    } else {
      index.set(key, [value])
    }
  }

  // indexes tradeable tiles once per pass so matching a trade doesn't scan the whole map
  function createTradeMatcher(tiles: Record<string, Tile>) {
    const parcelsByTokenId = new Map<string, { id: string; nftId: string }[]>()
    const tileIdsByEstateId = new Map<string, string[]>()
    for (const id in tiles) {
      const tile = tiles[id]
      if (!tile.nftId || !tile.tokenId) {
        continue
      }
      if (tile.estateId) {
        addToIndex(tileIdsByEstateId, tile.estateId, id)
      } else {
        addToIndex(parcelsByTokenId, tile.tokenId, { id, nftId: tile.nftId })
      }
    }

    return (trade: Trade): string[] => {
      const contract = trade.contract_address_sent?.toLowerCase()
      if (!contract || !trade.sent_token_id) {
        return []
      }
      const estateTileIds =
        contract === estateContractAddress.toLowerCase()
          ? tileIdsByEstateId.get(trade.sent_token_id) ?? []
          : []
      const parcelIds = (parcelsByTokenId.get(trade.sent_token_id) ?? [])
        .filter((parcel) => parcel.nftId.includes(contract))
        .map((parcel) => parcel.id)
      return [...estateTileIds, ...parcelIds]
    }
  }

  // puts back the order price (or no price) on tiles that still show last pass' trade price
  function restoreTradePrices(tiles: Record<string, Tile>) {
    const newTiles = { ...tiles }
    for (const [id, { tile, replaced }] of tradePrices) {
      // a tile rebuilt from newer subgraph data already carries its current order
      if (newTiles[id] !== tile) {
        continue
      }
      const restored: Tile = { ...tile, updatedAt: replaced.updatedAt }
      delete restored.price
      delete restored.expiresAt
      if (
        replaced.price !== undefined &&
        replaced.expiresAt !== undefined &&
        !isExpired({ ...restored, expiresAt: replaced.expiresAt })
      ) {
        restored.price = replaced.price
        restored.expiresAt = replaced.expiresAt
      }
      newTiles[id] = restored
    }
    return newTiles
  }

  async function updateTilesWithTrades(tiles: Record<string, Tile>) {
    try {
      const activeTrades = await trades.getActiveTrades()
      const newTiles = restoreTradePrices(tiles)
      const newTradePrices = new Map<string, TradePrice>()
      const findTileIds = createTradeMatcher(newTiles)

      for (const trade of activeTrades) {
        for (const id of findTileIds(trade)) {
          // read through newTiles so an earlier trade's price this pass is seen
          const tile = newTiles[id]
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
            const { price, expiresAt, ...tileWithoutOrder } = tile
            const tradeTile: Tile = {
              ...tileWithoutOrder,
              price: tradePrice,
              updatedAt: tradeCreatedAt,
            }
            newTiles[tile.id] = tradeTile
            newTradePrices.set(tile.id, {
              tile: tradeTile,
              replaced: newTradePrices.get(tile.id)?.replaced ?? {
                price,
                expiresAt,
                updatedAt: tile.updatedAt,
              },
            })
          }
        }
      }

      tradePrices = newTradePrices
      return newTiles
    } catch (error) {
      componentLogger.error(`Failed to update tiles with trades: ${error}`)
      return tiles
    }
  }

  // cached prices and updatedAt may come from trades that are gone, so take them from the fresh fetch
  function withFreshPrices(cachedTiles: Tile[], freshTiles: Tile[]): Tile[] {
    const freshById = new Map(freshTiles.map((tile) => [tile.id, tile]))
    return cachedTiles.map((cachedTile) => {
      const { price, expiresAt, ...tile } = cachedTile
      const freshTile = freshById.get(tile.id)
      if (!freshTile) {
        return tile
      }
      const freshOrder =
        freshTile.price !== undefined
          ? { price: freshTile.price, expiresAt: freshTile.expiresAt }
          : {}
      return { ...tile, ...freshOrder, updatedAt: freshTile.updatedAt }
    })
  }

  function havePricesChanged(
    oldTiles: Record<string, Tile>,
    newTiles: Record<string, Tile>
  ) {
    for (const id in newTiles) {
      const oldTile = oldTiles[id]
      const newTile = newTiles[id]
      if (
        !oldTile ||
        oldTile.price !== newTile.price ||
        oldTile.expiresAt !== newTile.expiresAt
      ) {
        return true
      }
    }
    return false
  }

  async function loadInitialData() {
    // Try to load cached tiles and timestamp from S3
    const [cachedTiles, cachedTimestamp] = await Promise.all([
      s3.getTilesJson('v2'),
      s3.getTimestamp(),
    ])

    const cache =
      cachedTiles &&
      cachedTimestamp &&
      cachedTimestamp.version === TILES_CACHE_VERSION
        ? {
            tiles: Object.values(cachedTiles),
            timestamp: cachedTimestamp.timestamp,
          }
        : null

    let initialTiles: Record<string, Tile>
    let result: Result
    let updatedAt: number

    if (cache && !hasStaleSpecialTiles(cache.tiles)) {
      componentLogger.info(
        'Found cached tiles in S3, using them to initialize the component'
      )

      // Set the lastUploadedTilesUrl when loading from cache
      lastUploadedTilesUrl = {
        v1: await s3.getFileUrl('v1'),
        v2: await s3.getFileUrl('v2'),
      }

      result = await batchApi.fetchData()
      updatedAt = cache.timestamp
      initialTiles = addSpecialTiles(
        addTiles(withFreshPrices(cache.tiles, result.tiles), {})
      )
    } else {
      componentLogger.info(
        cachedTiles
          ? 'Cached tiles in S3 are outdated, fetching fresh data'
          : 'No cached tiles found in S3, fetching fresh data'
      )
      result = await batchApi.fetchData()
      updatedAt = result.updatedAt
      initialTiles = addSpecialTiles(addTiles(result.tiles, {}))
    }

    const tilesWithTrades = await updateTilesWithTrades(initialTiles)
    const initialParcels = addParcels(result.parcels, {})
    const initialEstates = addEstates(result.estates, {})
    const initialTokens = addTokens(result.parcels, result.estates, {})

    lastUpdatedAt = updatedAt
    dataUpdatedAt = updatedAt
    tiles.resolve(tilesWithTrades)
    parcels.resolve(initialParcels)
    estates.resolve(initialEstates)
    tokens.resolve(initialTokens)
    ready = true

    if (stopped) {
      return
    }
    await uploadTilesToS3(tilesWithTrades)
    if (stopped) {
      return
    }
    events.emit(MapEvents.READY, {
      tiles: Object.values(tilesWithTrades),
      parcels: result.parcels,
      estates: result.estates,
      updatedAt: lastUpdatedAt,
    })
  }

  async function initialize() {
    while (!stopped) {
      try {
        await loadInitialData()
        break
      } catch (error) {
        componentLogger.error(
          `Failed to initialize map component, retrying in ${refreshInterval}ms: ${error}`
        )
        await sleep(refreshInterval)
      }
    }

    if (!stopped) {
      await sleep(refreshInterval)
      await poll()
    }
  }

  const lifeCycle: IBaseComponent = {
    // IBaseComponent.start lifecycle
    async start() {
      events.emit(MapEvents.INIT)
      // Fire-and-forget: the first load takes minutes and must not hold the HTTP server closed
      initialize().catch((error) =>
        componentLogger.error(`Map component stopped updating: ${error}`)
      )
    },
    async stop() {
      stopped = true
      for (const [timer, resolve] of pendingSleeps) {
        clearTimeout(timer)
        resolve()
      }
      pendingSleeps.clear()
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
    while (!stopped) {
      await tracer.span('Polling loop', async () => {
        try {
          const oldTiles = await tiles
          const oldParcels = await parcels
          const oldEstates = await estates

          const result = await api.fetchUpdatedData(lastUpdatedAt, oldTiles)
          const hasUpdates = result.tiles.length > 0
          // trades and order expirations are re-applied even without subgraph changes
          const newTiles = expireOrders(
            hasUpdates ? addTiles(result.tiles, oldTiles) : oldTiles
          )
          const tilesWithTrades = await updateTilesWithTrades(newTiles)
          // always swap in the new tiles: tradePrices tracks these objects
          tiles = future()
          tiles.resolve(tilesWithTrades)

          if (!hasUpdates && !havePricesChanged(oldTiles, tilesWithTrades)) {
            return
          }

          if (hasUpdates) {
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
          }

          // a trade-only change must still move Last-Modified forward by at least a second
          dataUpdatedAt = Math.max(
            hasUpdates ? result.updatedAt : Date.now(),
            dataUpdatedAt + 1000
          )

          if (stopped) {
            return
          }

          // upload new tiles to S3
          await uploadTilesToS3(tilesWithTrades)

          if (hasUpdates && !stopped) {
            events.emit(MapEvents.UPDATE, result)
          }
        } catch (error) {
          events.emit(MapEvents.ERROR, error)
        } finally {
          await sleep(refreshInterval)
        }
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
    return dataUpdatedAt
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
