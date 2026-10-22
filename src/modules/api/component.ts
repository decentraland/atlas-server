import { EventEmitter } from 'events'
import { RentalListing } from '@dcl/schemas'
import {
  IConfigComponent,
  ILoggerComponent,
  IMetricsComponent,
} from '@well-known-components/interfaces'
import { ISubgraphComponent } from '@dcl/thegraph-component'
import { isErrorWithMessage } from '../../logic/error'
import {
  getTokenIdFromNftId,
  isNftIdFromEstate,
  isNftIdFromParcel,
  leftMerge,
} from '../../logic/nfts'
import {
  convertRentalListingToTileRentalListing,
  TileRentalListing,
} from '../../adapters/rentals'
import {
  isExpired as isRentalListingExpired,
  isRentalListingOpen,
} from '../../logic/rental'
import {
  fromMillisecondsToSeconds,
  fromSecondsToMilliseconds,
} from '../../adapters/time'
import { Metrics } from '../../metrics'
import { Tile, TileType } from '../map/types'
import { coordsToId, specialTiles } from '../map/utils'
import { IRentalsComponent } from '../rentals/types'
import {
  ApiEvents,
  Batch,
  Cursors,
  ParcelFragment,
  IApiComponent,
  NFT,
  Attribute,
  EstateFragment,
  Result,
  DissolvedEstateFragment,
} from './types'
import {
  isExpired,
  getProximity,
  capitalize,
  getParcelFragmentRentalListing,
} from './utils'

const parcelFields = `{
  id
  name
  owner {
    id
  }
  searchParcelX
  searchParcelY
  searchParcelEstateId
  tokenId
  updatedAt
  activeOrder {
    price
    expiresAt
    createdAt
  }
  parcel {
    data {
      name
      description
    }
    estate {
      data {
        description
      }
      tokenId
      size
      nft {
        name
        owner {
          id
        }
        activeOrder {
          price
          expiresAt
          createdAt
        }
        updatedAt
      }
    }
  }
}`

const estateFields = `{
  id
  tokenId
  name
  updatedAt
  estate {
    size
    data {
      description
    }
  }
}`

// keeps the id_in list of a query short
const ESTATE_IDS_PER_QUERY = 100

type Snapshot = { block: number; timestamp: number }

export async function createApiComponent(components: {
  config: IConfigComponent
  rentals: IRentalsComponent
  subgraph: ISubgraphComponent
  logger: ILoggerComponent
  metrics: IMetricsComponent<keyof Metrics>
}): Promise<IApiComponent> {
  const { config, subgraph, rentals, logger, metrics } = components

  // config
  const batchSize = await config.requireNumber('API_BATCH_SIZE')
  const concurrency = await config.requireNumber('API_CONCURRENCY')
  const imageBaseUrl = await config.requireString('IMAGE_BASE_URL')
  const externalBaseUrl = await config.requireString('EXTERNAL_BASE_URL')
  const landContractAddress = await config.requireString(
    'LAND_CONTRACT_ADDRESS'
  )
  const estateContractAddress = await config.requireString(
    'ESTATE_CONTRACT_ADDRESS'
  )
  const componentLogger = logger.getLogger('API Component')

  // events
  const events = new EventEmitter()

  // methods
  // reads the subgraph's head so every query of a fetch sees the same block
  async function getSnapshot(): Promise<Snapshot> {
    const { _meta } = await subgraph.query<{
      _meta: { block: { number: number; timestamp: number | null } }
    }>(`{ _meta { block { number timestamp } } }`)
    const { number, timestamp } = _meta.block
    if (!timestamp) {
      throw new Error(`The subgraph did not report the timestamp of ${number}`)
    }
    return { block: number, timestamp }
  }

  // pages a query by id so a full page never truncates it
  async function queryAllById<T extends { id: string }>(
    entity: string,
    where: string,
    fields: string,
    snapshot: Snapshot
  ): Promise<T[]> {
    const items: T[] = []
    let lastId = ''
    while (true) {
      const { nfts } = await subgraph.query<{ nfts: T[] }>(
        `{
          nfts: ${entity}(
            first: ${batchSize},
            orderBy: id,
            orderDirection: asc,
            block: { number: ${snapshot.block} },
            where: { ${where}, id_gt: "${lastId}" }
          ) ${fields}
        }`
      )
      items.push(...nfts)
      if (nfts.length < batchSize) {
        return items
      }
      lastId = nfts[nfts.length - 1].id
    }
  }

  async function fetchParcelsOfEstates(
    estateNftIds: string[],
    snapshot: Snapshot
  ): Promise<ParcelFragment[]> {
    const parcels: ParcelFragment[] = []
    for (let i = 0; i < estateNftIds.length; i += ESTATE_IDS_PER_QUERY) {
      const ids = estateNftIds.slice(i, i + ESTATE_IDS_PER_QUERY)
      parcels.push(
        ...(await queryAllById<ParcelFragment>(
          'nfts',
          `category: parcel, searchParcelEstateId_in: ${JSON.stringify(ids)}`,
          parcelFields,
          snapshot
        ))
      )
    }
    return parcels
  }

  function toEstateNftId(estateTokenId: string) {
    return `estate-${estateContractAddress.toLowerCase()}-${estateTokenId}`
  }

  // builds each estate from all of its parcels, not only the ones a nested query returns
  function buildEstatesFromParcels(fragments: ParcelFragment[]): NFT[] {
    const estates = new Map<
      string,
      { fragment: ParcelFragment; coords: { x: string; y: string }[] }
    >()
    for (const fragment of fragments) {
      const { estate } = fragment.parcel
      if (!estate) {
        continue
      }
      const coords = { x: fragment.searchParcelX, y: fragment.searchParcelY }
      const entry = estates.get(estate.tokenId)
      if (entry) {
        entry.coords.push(coords)
      } else {
        estates.set(estate.tokenId, { fragment, coords: [coords] })
      }
    }
    const result: NFT[] = []
    for (const { fragment, coords } of estates.values()) {
      const estate = buildEstate(fragment, coords)
      if (estate) {
        result.push(estate)
      }
    }
    return result
  }

  // open listings past their expiration are left out, as the map would expire them anyway
  function indexOpenRentalListings(rentalListings: RentalListing[]) {
    const byNftId: Record<string, TileRentalListing> = {}
    for (const rentalListing of rentalListings) {
      const tileRentalListing =
        convertRentalListingToTileRentalListing(rentalListing)
      if (
        isRentalListingOpen(rentalListing) &&
        !isRentalListingExpired(tileRentalListing)
      ) {
        byNftId[rentalListing.nftId] = tileRentalListing
      }
    }
    return byNftId
  }

  async function fetchData() {
    // rental listings changing while the batches are fetched are picked up by the next update
    const rentalsCursor = Date.now()
    const snapshot = await getSnapshot()
    const rentalListingsByNftId = indexOpenRentalListings(
      await rentals.getOpenRentalListings()
    )
    const tiles: Tile[] = []
    const parcels: NFT[] = []
    const fragments: ParcelFragment[] = []

    // auxiliaries for fetching in batches

    let batches: Promise<Batch>[] = []
    let total = 0
    let complete = false
    let lastTokenId = ''

    while (!complete) {
      // fetch batch
      const batch = fetchBatch(
        snapshot,
        rentalListingsByNftId,
        lastTokenId,
        batches.length
      ).then((batch) => {
        // merge results
        for (const tile of batch.tiles) {
          tiles.push(tile)
        }
        for (const parcel of batch.parcels) {
          parcels.push(parcel)
        }
        for (const fragment of batch.fragments) {
          fragments.push(fragment)
        }

        // notify progress
        total = total + batch.tiles.length
        const progress = ((total / 90601) * 100) | 0 // there are 301x301=90601 parcels in the world
        events.emit(ApiEvents.PROGRESS, Math.min(99, progress))

        // resolve
        return batch
      })

      // when max concurrency is reached...
      batches.push(batch)
      if (batches.length === Math.max(concurrency, 1)) {
        // ...wait for all the batches to finish
        const results = await Promise.all(batches)
        // prepare next iteration
        complete = results
          .map((batch) => batch.tiles)
          .some((result) => result.length === 0)

        if (!complete) {
          // find last id
          lastTokenId = results
            .map((batch) => batch.tiles)
            .filter((result) => result.length > 0)
            .pop()!
            .pop()!.tokenId!
        }
        batches = []
      }
    }

    // final progress update
    events.emit(ApiEvents.PROGRESS, 100)

    const result: Result = {
      tiles,
      parcels,
      estates: buildEstatesFromParcels(fragments),
      updatedAt: tiles.reduce<number>(
        (lastUpdatedAt, tile) => Math.max(lastUpdatedAt, tile.updatedAt),
        0
      ),
      cursors: { land: snapshot.timestamp, rentals: rentalsCursor },
    }
    return result
  }

  async function fetchBatch(
    snapshot: Snapshot,
    rentalListingsByNftId: Record<string, TileRentalListing>,
    lastTokenId = '',
    page = 0
  ) {
    const { nfts } = await subgraph.query<{ nfts: ParcelFragment[] }>(
      `{
        nfts(
          first: ${batchSize},
          skip: ${batchSize * page},
          orderBy: tokenId,
          orderDirection: asc,
          block: { number: ${snapshot.block} },
          where: {
            ${lastTokenId ? `tokenId_gt: "${lastTokenId}",` : ''}
            category: parcel
          }
        ) ${parcelFields}
      }`
    )
    return nfts.reduce<Batch & { fragments: ParcelFragment[] }>(
      (batch, nft) => {
        const tileRentalListing =
          rentalListingsByNftId[nft.searchParcelEstateId ?? nft.id]
        batch.tiles.push(buildTile(nft, tileRentalListing))
        batch.parcels.push(buildParcel(nft))
        batch.fragments.push(nft)
        return batch
      },
      { tiles: [], parcels: [], estates: [], fragments: [] }
    )
  }

  // the tiles whose rental listing disagrees with the open listings, corrected
  function reconcileRentalListings(
    oldTiles: Record<string, Tile>,
    openRentalListings: RentalListing[]
  ): Tile[] {
    const openByNftId = indexOpenRentalListings(openRentalListings)
    const tiles: Tile[] = []
    for (const tile of Object.values(oldTiles)) {
      if (!tile.nftId) {
        continue
      }
      const expected =
        openByNftId[tile.estateId ? toEstateNftId(tile.estateId) : tile.nftId]
      if (expected) {
        if (tile.rentalListing?.updatedAt !== expected.updatedAt) {
          tiles.push({ ...tile, rentalListing: expected })
        }
      } else if (tile.rentalListing) {
        const { rentalListing, ...tileWithoutRentalListing } = tile
        tiles.push(tileWithoutRentalListing)
      }
    }
    return tiles
  }

  async function fetchLandChanges(
    cursors: Cursors,
    oldTiles: Record<string, Tile>
  ) {
    const snapshot = await getSnapshot()
    const updatedAfter = `updatedAt_gt: "${cursors.land}"`
    const [parcels, estates] = await Promise.all([
      queryAllById<ParcelFragment>(
        'nfts',
        `category: parcel, ${updatedAfter}`,
        parcelFields,
        snapshot
      ),
      queryAllById<EstateFragment>(
        'nfts',
        `category: estate, ${updatedAfter}`,
        estateFields,
        snapshot
      ),
    ])

    // estates whose parcels, size or proximity may have changed: the updated ones and the ones updated parcels joined or left
    const affectedEstateIds = new Set(estates.map((estate) => estate.id))
    for (const parcel of parcels) {
      if (parcel.searchParcelEstateId) {
        affectedEstateIds.add(parcel.searchParcelEstateId)
      }
      const previousEstateId =
        oldTiles[
          coordsToId(
            parseInt(parcel.searchParcelX, 10),
            parseInt(parcel.searchParcelY, 10)
          )
        ]?.estateId
      if (previousEstateId) {
        affectedEstateIds.add(toEstateNftId(previousEstateId))
      }
    }
    const estateParcels = await fetchParcelsOfEstates(
      Array.from(affectedEstateIds),
      snapshot
    )
    return { snapshot, parcels, estates, estateParcels }
  }

  async function fetchUpdatedData(
    cursors: Cursors,
    oldTiles: Record<string, Tile>,
    options: { sweepRentals?: boolean } = {}
  ): Promise<Result> {
    const updatedRentalListings =
      // timestamp in signatures server has microsecond precision. Adding one to avoid returning
      // the same rental listing previously saved
      rentals.getUpdatedRentalListings(cursors.rentals + 1)
    const openRentalListings = options.sweepRentals
      ? rentals.getOpenRentalListings()
      : Promise.resolve(null)

    const [landsSettlement, rentalListingsSettlement, sweepSettlement] =
      await Promise.allSettled([
        fetchLandChanges(cursors, oldTiles),
        updatedRentalListings,
        openRentalListings,
      ])

    // without the land changes the pass can't be applied consistently, so it fails and the previous map stays
    if (landsSettlement.status === 'rejected') {
      componentLogger.error(
        `Failed to retrieve updated information about the lands: ${landsSettlement.reason}`
      )
      metrics.increment('dcl_map_update', { type: 'land', status: 'failure' })
      throw new Error(
        `Failed to fetch update data: ${
          isErrorWithMessage(landsSettlement.reason)
            ? landsSettlement.reason.message
            : 'Unknown error'
        }`
      )
    }
    const { snapshot, parcels, estates, estateParcels } = landsSettlement.value
    metrics.increment('dcl_map_update', { type: 'land', status: 'success' })

    // a rental listings failure keeps their previous state and cursor
    let rentalListings: RentalListing[] = []
    if (rentalListingsSettlement.status === 'fulfilled') {
      rentalListings = rentalListingsSettlement.value
      metrics.increment('dcl_map_update', {
        type: 'rental',
        status: 'success',
      })
    } else {
      componentLogger.error(
        `Failed to retrieve updated information about the rental listings: ${rentalListingsSettlement.reason}`
      )
      metrics.increment('dcl_map_update', {
        type: 'rental',
        status: 'failure',
      })
    }

    // the full sweep corrects listings whose updates were missed
    let sweptTiles: Tile[] = []
    let rentalsSwept = false
    if (sweepSettlement.status === 'fulfilled' && sweepSettlement.value) {
      sweptTiles = reconcileRentalListings(oldTiles, sweepSettlement.value)
      rentalsSwept = true
    } else if (sweepSettlement.status === 'rejected') {
      componentLogger.error(
        `Failed to sweep the open rental listings: ${sweepSettlement.reason}`
      )
    }
    const currentTiles = sweptTiles.length
      ? {
          ...oldTiles,
          ...Object.fromEntries(sweptTiles.map((tile) => [tile.id, tile])),
        }
      : oldTiles

    // Gets the rental listings by nft id to use them more efficiently later.
    const rentalListingByNftId: Record<string, RentalListing> = {}
    for (const rentalListing of rentalListings) {
      const current = rentalListingByNftId[rentalListing.nftId]
      if (!current || current.updatedAt <= rentalListing.updatedAt) {
        rentalListingByNftId[rentalListing.nftId] = rentalListing
      }
    }

    const newCursors: Cursors = {
      // everything up to the snapshot's block has been read
      land: Math.max(cursors.land, snapshot.timestamp),
      rentals: rentalListings.reduce(
        (cursor, rentalListing) => Math.max(cursor, rentalListing.updatedAt),
        cursors.rentals
      ),
    }
    const updatedAt = Math.max(
      fromSecondsToMilliseconds(newCursors.land),
      newCursors.rentals
    )

    if (
      !parcels.length &&
      !estates.length &&
      !rentalListings.length &&
      !sweptTiles.length
    ) {
      return {
        tiles: [],
        parcels: [],
        estates: [],
        updatedAt,
        cursors: newCursors,
        ...(rentalsSwept && { rentalsSwept }),
      }
    }

    // Gets the tiles by estate id and by nft id to use them more efficiently later.
    const tilesByEstateId: Record<string, Tile[]> = {}
    const tilesByNftId: Record<string, Tile> = {}
    for (const tile of Object.values(currentTiles)) {
      if (tile.estateId) {
        ;(tilesByEstateId[tile.estateId] ??= []).push(tile)
      }
      if (tile.nftId) {
        tilesByNftId[tile.nftId] = tile
      }
    }

    // Creates the tiles that are being updated because of a new / updated rental listings.
    const updatedTilesByRentalListings: Tile[] = []
    for (const rentalListing of rentalListings) {
      if (!rentalListing.nftId) {
        componentLogger.error(
          `Rental listing has a wrong nft id: ${rentalListing.nftId}`
        )
        continue
      }
      const tokenId = getTokenIdFromNftId(rentalListing.nftId)
      if (!tokenId) {
        throw new Error(
          `Could not retrieve token id from ${rentalListing.nftId}`
        )
      }
      const tileRentalListing = isRentalListingOpen(rentalListing)
        ? convertRentalListingToTileRentalListing(rentalListing)
        : undefined
      const tiles = isNftIdFromParcel(rentalListing.nftId)
        ? tilesByNftId[rentalListing.nftId]
          ? [tilesByNftId[rentalListing.nftId]]
          : []
        : isNftIdFromEstate(rentalListing.nftId)
        ? tilesByEstateId[tokenId] ?? []
        : []
      for (const tile of tiles) {
        updatedTilesByRentalListings.push({
          ...tile,
          updatedAt: Math.max(tile.updatedAt, rentalListing.updatedAt),
          rentalListing: tileRentalListing,
        })
      }
    }

    // parcels updated themselves plus every parcel of an updated estate, whose name, owner or order may have changed
    const changedEstateIds = new Set(estates.map((estate) => estate.id))
    const updatedFragments = new Map<string, ParcelFragment>()
    for (const parcel of parcels) {
      updatedFragments.set(parcel.id, parcel)
    }
    for (const parcel of estateParcels) {
      if (
        parcel.searchParcelEstateId &&
        changedEstateIds.has(parcel.searchParcelEstateId) &&
        !updatedFragments.has(parcel.id)
      ) {
        updatedFragments.set(parcel.id, parcel)
      }
    }
    const fragments = Array.from(updatedFragments.values())

    const updatedTiles = leftMerge(
      leftMerge(sweptTiles, updatedTilesByRentalListings),
      fragments.map((parcel) =>
        buildTile(
          parcel,
          getParcelFragmentRentalListing(
            parcel,
            rentalListingByNftId,
            tilesByNftId
          )
        )
      )
    )

    // an estate left without parcels was dissolved, its stale entry is replaced
    const dissolvedEstates = estates
      .filter((estate) => estate.estate.size === 0)
      .map((estate) =>
        buildDissolvedEstate(
          estate.tokenId,
          estate.name ?? '',
          estate.estate.data?.description ?? ''
        )
      )

    componentLogger.info(
      `Last updates | block: ${snapshot.block} - land: ${newCursors.land} - rentals: ${newCursors.rentals}`
    )

    return {
      tiles: updatedTiles,
      parcels: fragments.map((parcel) => buildParcel(parcel)),
      estates: [...buildEstatesFromParcels(estateParcels), ...dissolvedEstates],
      updatedAt,
      cursors: newCursors,
      ...(rentalsSwept && { rentalsSwept }),
    }
  }

  function buildTile(
    fragment: ParcelFragment,
    rentalListing?: TileRentalListing
  ): Tile {
    const {
      id: nftId,
      owner: parcelOwner,
      name: parcelName,
      searchParcelX,
      searchParcelY,
      searchParcelEstateId,
      tokenId,
      updatedAt: parcelUpdatedAt,
      activeOrder: parcelActiveOrder,
      parcel: { estate },
    } = fragment

    const x = parseInt(searchParcelX)
    const y = parseInt(searchParcelY)
    const id = coordsToId(x, y)
    const name = (estate && estate.nft.name) || parcelName
    const owner = (estate && estate.nft.owner) || parcelOwner
    const activeOrder = (estate && estate.nft.activeOrder) || parcelActiveOrder
    const updatedAt = Math.max(
      fromSecondsToMilliseconds(
        estate ? parseInt(estate.nft.updatedAt, 10) : 0
      ),
      fromSecondsToMilliseconds(parseInt(parcelUpdatedAt, 10)),
      rentalListing?.updatedAt || 0
    )

    // special tiles are plazas, districts and roads
    const specialTile = id in specialTiles ? specialTiles[id] : null

    const tile: Tile = {
      id,
      x,
      y,
      nftId,
      updatedAt,
      type: specialTile
        ? specialTile.type
        : owner
        ? TileType.OWNED
        : TileType.UNOWNED,
      top: specialTile ? specialTile.top : false,
      left: specialTile ? specialTile.left : false,
      topLeft: specialTile ? specialTile.topLeft : false,
    }

    if (name) {
      tile.name = name
    }

    if (searchParcelEstateId) {
      tile.estateId = searchParcelEstateId.split('-').pop()! // estate-0xdeadbeef-<id>
    }

    if (owner) {
      tile.owner = owner.id
    }

    if (activeOrder && !isExpired(activeOrder)) {
      tile.price = Math.round(parseInt(activeOrder.price) / 1e18)
      tile.expiresAt =
        activeOrder.expiresAt.length === 10
          ? parseInt(activeOrder.expiresAt, 10)
          : Math.round(parseInt(activeOrder.expiresAt, 10) / 1000)
      if (activeOrder.createdAt) {
        tile.orderCreatedAt = fromSecondsToMilliseconds(
          parseInt(activeOrder.createdAt, 10)
        )
      }
    }

    if (tokenId) {
      tile.tokenId = tokenId
    }

    if (rentalListing) {
      tile.rentalListing = rentalListing
    }

    return tile
  }

  function buildParcel(fragment: ParcelFragment): NFT {
    const {
      searchParcelX,
      searchParcelY,
      tokenId,
      parcel: { data },
    } = fragment

    const x = parseInt(searchParcelX, 10)
    const y = parseInt(searchParcelY, 10)

    const attributes: Attribute[] = [
      {
        trait_type: 'X',
        value: x,
        display_type: 'number',
      },
      {
        trait_type: 'Y',
        value: y,
        display_type: 'number',
      },
    ]

    const proximity = getProximity([{ x, y }])
    if (proximity) {
      for (const key of Object.keys(proximity)) {
        attributes.push({
          trait_type: `Distance to ${capitalize(key)}`,
          value: parseInt((proximity as any)[key], 10),
          display_type: 'number',
        })
      }
    }

    return {
      id: tokenId,
      name: (data && data.name) || `Parcel ${x},${y}`,
      description: (data && data.description) || '',
      image: `${imageBaseUrl}/parcels/${x}/${y}/map.png?size=24&width=1024&height=1024`,
      external_url: `${externalBaseUrl}/contracts/${landContractAddress}/tokens/${tokenId}`,
      attributes,
      background_color: '000000',
    }
  }

  function buildEstate(
    fragment: ParcelFragment,
    parcels: { x: string; y: string }[]
  ): NFT | null {
    const {
      parcel: { estate },
    } = fragment
    if (!estate) return null

    const { size, tokenId, data } = estate
    const { name } = estate.nft
    const attributes: Attribute[] = [
      {
        trait_type: 'Size',
        value: size ?? 0,
        display_type: 'number',
      },
    ]
    const proximity = getProximity(parcels)
    if (proximity) {
      for (const key of Object.keys(proximity)) {
        attributes.push({
          trait_type: `Distance to ${capitalize(key)}`,
          value: parseInt((proximity as any)[key], 10),
          display_type: 'number',
        })
      }
    }

    return {
      id: tokenId,
      name,
      description: data?.description || '',
      image: `${imageBaseUrl}/estates/${tokenId}/map.png?size=24&width=1024&height=1024`,
      external_url: `${externalBaseUrl}/contracts/${estateContractAddress}/tokens/${tokenId}`,
      attributes,
      background_color: '000000',
    }
  }

  async function getDissolvedEstate(estateId: string): Promise<NFT | null> {
    if (estateId && !estateId.match(`^[0-9]+$`)) {
      return null
    }
    const { nfts } = await subgraph.query<{ nfts: DissolvedEstateFragment[] }>(
      `{
        nfts(
          where: {
            tokenId: ${estateId}
            category: estate
            searchEstateSize: 0
          }
        ) {
          name
          estate {
            data {
              description
            }
          }
        }
      }`
    )
    if (nfts.length === 1) {
      const nft = nfts[0]
      return buildDissolvedEstate(
        estateId,
        nft.name,
        nft.estate.data?.description || ''
      )
    } else {
      return null
    }
  }

  function buildDissolvedEstate(
    estateId: string,
    name: string,
    description: string
  ): NFT {
    return {
      id: estateId,
      name,
      description,
      image: `${imageBaseUrl}/estates/${estateId}/map.png?size=24&width=1024&height=1024`,
      external_url: `${externalBaseUrl}/contracts/${estateContractAddress}/tokens/${estateId}`,
      attributes: [
        {
          trait_type: 'Size',
          value: 0,
          display_type: 'number',
        },
      ],
      background_color: '000000',
    }
  }

  return {
    events,
    fetchData,
    fetchUpdatedData,
    getDissolvedEstate,
  }
}
