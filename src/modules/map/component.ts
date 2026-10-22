import {
  IBaseComponent,
  IStatusCheckCapableComponent,
} from '@well-known-components/interfaces'
import { EventEmitter } from 'events'
import future from 'fp-future'
import { Cursors, NFT, Result } from '../api/types'
import { IMapComponent, Tile, MapEvents } from './types'
import {
  addSpecialTiles,
  computeEstate,
  getEstateDependentIds,
  getEstateFlags,
  isExpired,
  isSameTile,
  stableStringify,
} from './utils'
import { isExpired as isRentalListingExpired } from '../../logic/rental'
import { toLegacyTiles } from '../../adapters/legacy-tiles'
import { Trade } from '../trades/component'
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
  const rentalsSweepInterval =
    (await config.requireNumber('RENTALS_SWEEP_INTERVAL')) * 1000
  const landContractAddress = await config.requireString(
    'LAND_CONTRACT_ADDRESS'
  )
  const estateContractAddress = await config.requireString(
    'ESTATE_CONTRACT_ADDRESS'
  )

  // events
  const events = new EventEmitter()

  // data
  // served tiles: the base tiles with the active trades applied
  let tiles = future<Record<string, Tile>>()
  // tiles as the subgraph and rentals describe them, without trades
  let baseTiles: Record<string, Tile> = {}
  let parcels = future<Record<string, NFT>>()
  let estates = future<Record<string, NFT>>()
  let tokens = future<Record<string, NFT>>()
  let ready = false
  let stopped = false
  const pendingSleeps = new Map<NodeJS.Timeout, () => void>()
  // last trades fetched, reused when fetching them fails
  let activeTrades: Trade[] = []
  let cursors: Cursors = { land: 0, rentals: 0 }
  let lastRentalsSweepAt = 0
  let lastUpdatedAt = 0 // newest change fetched, in ms
  let dataUpdatedAt = 0 // last change to the served data, in ms
  let lastUploadedTilesUrl: { v1?: string; v2?: string } = {}

  // methods
  // builds the next tiles without mutating the given ones, which may be the ones being served
  function addTiles(newTiles: Tile[], oldTiles: Record<string, Tile>) {
    const nextTiles = { ...oldTiles }
    const addedIds = new Set<string>()
    const dependentIds = new Set<string>()
    for (const tile of newTiles) {
      nextTiles[tile.id] = tile
      addedIds.add(tile.id)
    }
    for (const tile of newTiles) {
      for (const id of getEstateDependentIds(tile.x, tile.y)) {
        dependentIds.add(id)
      }
    }
    for (const id of dependentIds) {
      const tile = nextTiles[id]
      if (!tile) {
        continue
      }
      if (addedIds.has(id)) {
        computeEstate(tile.x, tile.y, nextTiles)
        continue
      }
      const flags = getEstateFlags(tile.x, tile.y, nextTiles)
      if (
        flags &&
        (flags.top !== tile.top ||
          flags.left !== tile.left ||
          flags.topLeft !== tile.topLeft)
      ) {
        nextTiles[id] = { ...tile, ...flags }
      }
    }
    return nextTiles
  }

  function getParcelKey(parcel: NFT): string | null {
    const xAttr = parcel.attributes.find(
      (attribute) => attribute.trait_type === 'X'
    )
    const yAttr = parcel.attributes.find(
      (attribute) => attribute.trait_type === 'Y'
    )
    return xAttr && yAttr ? xAttr.value + ',' + yAttr.value : null
  }

  function addParcels(newParcels: NFT[], oldParcels: Record<string, NFT>) {
    for (const parcel of newParcels) {
      const id = getParcelKey(parcel)
      if (id !== null) {
        oldParcels[id] = parcel
      }
    }

    return oldParcels
  }

  // drops what the map already has: updates overlap the previous fetch, and re-reads must not count as changes
  function withoutUnchanged(
    result: Result,
    oldParcels: Record<string, NFT>,
    oldEstates: Record<string, NFT>
  ): Result {
    const isSameNft = (a: NFT | undefined, b: NFT) =>
      !!a && stableStringify(a) === stableStringify(b)
    return {
      ...result,
      tiles: result.tiles.filter(
        (tile) => !isSameTile(baseTiles[tile.id], tile)
      ),
      parcels: result.parcels.filter((parcel) => {
        const key = getParcelKey(parcel)
        return key === null || !isSameNft(oldParcels[key], parcel)
      }),
      estates: result.estates.filter(
        (estate) => !isSameNft(oldEstates[estate.id], estate)
      ),
    }
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
      oldTokens[landContractAddress.toLowerCase() + '-' + parcel.id] = parcel
    }
    for (const estate of newEstates) {
      oldTokens[estateContractAddress.toLowerCase() + '-' + estate.id] = estate
    }

    return oldTokens
  }

  // returns the same record when nothing expired, saving a copy of the map
  function expireOrders(tiles: Record<string, Tile>) {
    let newTiles: Record<string, Tile> | null = null

    for (const id in tiles) {
      const tile = tiles[id]

      const orderExpired = isExpired(tile)
      const rentalExpired =
        !!tile.rentalListing && isRentalListingExpired(tile.rentalListing)
      if (orderExpired || rentalExpired) {
        const expiredTile = { ...tile }
        if (orderExpired) {
          delete expiredTile.price
          delete expiredTile.expiresAt
          delete expiredTile.orderCreatedAt
        }
        if (rentalExpired) {
          delete expiredTile.rentalListing
        }
        newTiles ??= { ...tiles }
        newTiles[id] = expiredTile
      }
    }

    return newTiles ?? tiles
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

  async function fetchActiveTrades() {
    try {
      activeTrades = await trades.getActiveTrades()
    } catch (error) {
      componentLogger.error(`Failed to update tiles with trades: ${error}`)
    }
    return activeTrades
  }

  // builds the served tiles: the base tiles with the newest of each tile's order and trades
  function applyTrades(base: Record<string, Tile>, activeTrades: Trade[]) {
    const servedTiles: Record<string, Tile> = {}
    for (const id in base) {
      const tile = base[id]
      if (tile.orderCreatedAt === undefined) {
        servedTiles[id] = tile
      } else {
        const { orderCreatedAt, ...servedTile } = tile
        servedTiles[id] = servedTile
      }
    }

    // when the tile's price was set, so a trade only overrides an older listing
    const pricedAt = new Map<string, number>()
    const findTileIds = createTradeMatcher(base)
    for (const trade of activeTrades) {
      for (const id of findTileIds(trade)) {
        const tile = servedTiles[id]
        const tradeCreatedAt = new Date(trade.created_at).getTime()
        const tradePrice = Math.round(parseInt(trade.amount_received) / 1e18)
        // tiles without the order's creation time fall back to their last update
        const currentPricedAt =
          pricedAt.get(id) ?? base[id].orderCreatedAt ?? tile.updatedAt

        if (!tile.price || tradeCreatedAt > currentPricedAt) {
          const { price, expiresAt, ...tileWithoutOrder } = tile
          servedTiles[id] = {
            ...tileWithoutOrder,
            price: tradePrice,
            updatedAt: tradeCreatedAt,
          }
          pricedAt.set(id, tradeCreatedAt)
        }
      }
    }
    return servedTiles
  }

  function haveServedTilesChanged(
    oldTiles: Record<string, Tile>,
    newTiles: Record<string, Tile>
  ) {
    for (const id in newTiles) {
      const oldTile = oldTiles[id]
      const newTile = newTiles[id]
      if (
        !oldTile ||
        oldTile.price !== newTile.price ||
        oldTile.expiresAt !== newTile.expiresAt ||
        oldTile.rentalListing !== newTile.rentalListing
      ) {
        return true
      }
    }
    return false
  }

  async function loadInitialData() {
    // tiles cached in S3 go stale while the service is down, so the map always starts from a full fetch
    componentLogger.info('Fetching the full map')
    const result = await batchApi.fetchData()
    const initialBaseTiles = expireOrders(
      addSpecialTiles(addTiles(result.tiles, {}))
    )
    const tilesWithTrades = applyTrades(
      initialBaseTiles,
      await fetchActiveTrades()
    )
    const initialParcels = addParcels(result.parcels, {})
    const initialEstates = addEstates(result.estates, {})
    const initialTokens = addTokens(result.parcels, result.estates, {})

    baseTiles = initialBaseTiles
    cursors = result.cursors
    // the full fetch reads every open rental listing
    lastRentalsSweepAt = Date.now()
    lastUpdatedAt = result.updatedAt
    dataUpdatedAt = result.updatedAt
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

          const sweepRentals =
            Date.now() - lastRentalsSweepAt >= rentalsSweepInterval
          let result: Result | null = null
          try {
            result = withoutUnchanged(
              await api.fetchUpdatedData(cursors, baseTiles, {
                sweepRentals,
              }),
              oldParcels,
              oldEstates
            )
          } catch (error) {
            // the land changes are retried next pass; expirations and trades still apply meanwhile
            events.emit(MapEvents.ERROR, error)
          }
          if (result?.rentalsSwept) {
            lastRentalsSweepAt = Date.now()
          }
          const hasUpdates =
            !!result &&
            (result.tiles.length > 0 ||
              result.parcels.length > 0 ||
              result.estates.length > 0)
          // trades and order expirations are re-applied even without subgraph changes
          const nextBaseTiles = expireOrders(
            result && hasUpdates ? addTiles(result.tiles, baseTiles) : baseTiles
          )
          const tilesWithTrades = applyTrades(
            nextBaseTiles,
            await fetchActiveTrades()
          )
          baseTiles = nextBaseTiles
          if (result) {
            cursors = result.cursors
          }
          tiles = future()
          tiles.resolve(tilesWithTrades)

          if (
            !hasUpdates &&
            !haveServedTilesChanged(oldTiles, tilesWithTrades)
          ) {
            return
          }

          if (result && hasUpdates) {
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

            lastUpdatedAt = result.updatedAt
          }

          // a trade-only change must still move Last-Modified forward by at least a second
          dataUpdatedAt = Math.max(
            result && hasUpdates ? result.updatedAt : Date.now(),
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
        cursors,
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
    const id = contractAddress.toLowerCase() + '-' + tokenId
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
