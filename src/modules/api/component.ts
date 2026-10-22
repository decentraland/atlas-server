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
import { isRentalListingOpen } from '../../logic/rental'
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
  buildFromEstates,
  getFragmentUpdatedAt,
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
      parcels {
        x
        y
      }
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
  async function fetchData() {
    // rental listings changing while the batches are fetched are picked up by the next update
    const rentalsCursor = Date.now()
    const tiles: Tile[] = []
    const parcels: NFT[] = []
    const estates: NFT[] = []

    // auxiliaries for fetching in batches

    let batches: Promise<Batch>[] = []
    let total = 0
    let complete = false
    let lastTokenId = ''
    let landCursor = 0

    while (!complete) {
      // fetch batch
      const batch = fetchBatch(lastTokenId, batches.length).then((batch) => {
        // merge results
        for (const tile of batch.tiles) {
          tiles.push(tile)
        }
        for (const parcel of batch.parcels) {
          parcels.push(parcel)
        }
        for (const estate of batch.estates) {
          estates.push(estate)
        }
        landCursor = Math.max(landCursor, batch.landUpdatedAt)

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
      // remove duplicates
      estates: Array.from(
        estates.reduce<Map<string, NFT>>(
          (map, nft) => map.set(nft.id, nft),
          new Map()
        ),
        ([_key, value]) => value
      ),
      updatedAt: tiles.reduce<number>(
        (lastUpdatedAt, tile) => Math.max(lastUpdatedAt, tile.updatedAt),
        0
      ),
      cursors: { land: landCursor, rentals: rentalsCursor },
    }
    return result
  }

  async function fetchBatch(lastTokenId = '', page = 0) {
    const { nfts } = await subgraph.query<{ nfts: ParcelFragment[] }>(
      `{
        nfts(
          first: ${batchSize},
          skip: ${batchSize * page},
          orderBy: tokenId,
          orderDirection: asc,
          where: {
            ${lastTokenId ? `tokenId_gt: "${lastTokenId}",` : ''}
            category: parcel
          }
        ) ${parcelFields}
      }`
    )
    const rentalListings = await rentals.getRentalsListingsOfNFTs(
      Array.from(new Set(nfts.map((nft) => nft.searchParcelEstateId ?? nft.id)))
    )
    const tileRentalListings =
      nfts.length > 0
        ? Object.fromEntries(
            Object.entries(rentalListings).map(([key, value]) => [
              key,
              convertRentalListingToTileRentalListing(value),
            ])
          )
        : {}
    return nfts.reduce<Batch & { landUpdatedAt: number }>(
      (batch, nft) => {
        const tileRentalListing =
          tileRentalListings[nft.searchParcelEstateId ?? nft.id]
        const tile = buildTile(nft, tileRentalListing)
        const parcel = buildParcel(nft)
        const estate = buildEstate(nft)
        batch.tiles.push(tile)
        batch.parcels.push(parcel)
        if (estate) {
          batch.estates.push(estate)
        }
        batch.landUpdatedAt = Math.max(
          batch.landUpdatedAt,
          getFragmentUpdatedAt(nft)
        )
        return batch
      },
      { tiles: [], parcels: [], estates: [], landUpdatedAt: 0 }
    )
  }

  async function fetchUpdatedData(
    cursors: Cursors,
    oldTiles: Record<string, Tile>
  ): Promise<Result> {
    const updatedLand = subgraph.query<{
      parcels: ParcelFragment[]
      estates: EstateFragment[]
    }>(
      `{
        parcels: nfts(
          first: ${batchSize},
          orderBy: updatedAt,
          orderDirection: asc,
          where: {
            updatedAt_gt: "${cursors.land}",
            category: parcel
          }
        ) ${parcelFields}
        estates: nfts(
          first: ${batchSize},
          orderBy: updatedAt,
          orderDirection: asc,
          where: {
            updatedAt_gt: "${cursors.land}",
            category: estate
          }
        ) {
          tokenId
          name
          updatedAt
          estate {
            size
            data {
              description
            }
            parcels {
              nft ${parcelFields}
            }
          }
        }
      }`
    )
    const updatedRentalListings =
      // timestamp in signatures server has microsecond precision. Adding one to avoid returning
      // the same rental listing previously saved
      rentals.getUpdatedRentalListings(cursors.rentals + 1)

    const [landsSettlement, rentalListingsSettlement] =
      await Promise.allSettled([updatedLand, updatedRentalListings])

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
    const { parcels, estates } = landsSettlement.value
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

    // Gets the rental listings by nft id to use them more efficiently later.
    const rentalListingByNftId: Record<string, RentalListing> = {}
    for (const rentalListing of rentalListings) {
      const current = rentalListingByNftId[rentalListing.nftId]
      if (!current || current.updatedAt <= rentalListing.updatedAt) {
        rentalListingByNftId[rentalListing.nftId] = rentalListing
      }
    }

    const newCursors: Cursors = {
      land: [...parcels, ...estates].reduce(
        (cursor, nft) => Math.max(cursor, parseInt(nft.updatedAt, 10)),
        cursors.land
      ),
      rentals: rentalListings.reduce(
        (cursor, rentalListing) => Math.max(cursor, rentalListing.updatedAt),
        cursors.rentals
      ),
    }
    const updatedAt = Math.max(
      fromSecondsToMilliseconds(newCursors.land),
      newCursors.rentals
    )

    if (!parcels.length && !estates.length && !rentalListings.length) {
      return {
        tiles: [],
        parcels: [],
        estates: [],
        updatedAt,
        cursors: newCursors,
      }
    }

    // Gets the tiles by estate id and by nft id to use them more efficiently later.
    const tilesByEstateId: Record<string, Tile[]> = {}
    const tilesByNftId: Record<string, Tile> = {}
    for (const tile of Object.values(oldTiles)) {
      if (tile.estateId) {
        ;(tilesByEstateId[tile.estateId] ??= []).push(tile)
      }
      if (tile.nftId) {
        tilesByNftId[tile.nftId] = tile
      }
    }

    // Creates the tiles that are being updated because of a new / updated rental listings.
    const updatedTilesByRentalListings: Tile[] = rentalListings
      .flatMap((rentalListing) => {
        if (!rentalListing.nftId) {
          console.error(
            `Rental listing has a wrong nft id: ${rentalListing.nftId}`
          )
          return null
        }
        const tokenId = getTokenIdFromNftId(rentalListing.nftId)
        if (!tokenId) {
          throw new Error(
            `Could not retrieve token id from ${rentalListing.nftId}`
          )
        }

        if (
          isNftIdFromParcel(rentalListing.nftId) &&
          tilesByNftId[rentalListing.nftId]
        ) {
          const currentTile = tilesByNftId[rentalListing.nftId]
          return {
            ...currentTile,
            updatedAt: Math.max(currentTile.updatedAt, rentalListing.updatedAt),
            rentalListing: isRentalListingOpen(rentalListing)
              ? convertRentalListingToTileRentalListing(rentalListing)
              : undefined,
          }
        } else if (
          isNftIdFromEstate(rentalListing.nftId) &&
          tilesByEstateId[tokenId] !== undefined
        ) {
          return tilesByEstateId[tokenId].map((tile) => ({
            ...tile,
            updatedAt: Math.max(tile.updatedAt, rentalListing.updatedAt),
            rentalListing: isRentalListingOpen(rentalListing)
              ? convertRentalListingToTileRentalListing(rentalListing)
              : undefined,
          }))
        }
        return null
      })
      .filter((tile) => tile !== null) as Tile[]

    // Creates the tiles that are being updated given the updated parcels.
    const updatedTilesByUpdatedParcels = parcels.map((parcel) =>
      buildTile(
        parcel,
        getParcelFragmentRentalListing(
          parcel,
          rentalListingByNftId,
          tilesByNftId
        )
      )
    )

    // Merges the updates tiles whose change was originated from the rental listings with the ones that came from the graph.
    const updatedTiles = leftMerge(
      updatedTilesByRentalListings,
      updatedTilesByUpdatedParcels
    )

    // Build the updated parcels from the updates parcels that came from the graph.
    const updatedParcels = parcels.map((parcel) => buildParcel(parcel))

    // Build the estates from the updates estates that came from the graph.
    const updatedEstates = parcels
      .map((parcel) => buildEstate(parcel))
      .filter((estate) => estate !== null) as NFT[]

    // The following piece adds tiles from updated Estates. This is necessary only for an Estate that get listed or delisted on sale, since that doesn't change the lastUpdatedAt property of a Parcel.
    const updatedTilesFromEstates = buildFromEstates(
      estates,
      updatedTiles,
      (parcel) =>
        buildTile(
          parcel,
          getParcelFragmentRentalListing(
            parcel,
            rentalListingByNftId,
            tilesByNftId
          )
        )
    )
    const updatedParcelsFromEstates = buildFromEstates(
      estates,
      updatedParcels,
      buildParcel
    )
    const updatedEstatesFromEstates = buildFromEstates(
      estates,
      updatedEstates,
      buildEstate
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

    const batch: Batch = {
      tiles: [...updatedTiles, ...updatedTilesFromEstates],
      parcels: [...updatedParcels, ...updatedParcelsFromEstates],
      estates: [
        ...updatedEstates,
        ...updatedEstatesFromEstates,
        ...dissolvedEstates,
      ],
    }

    componentLogger.info(
      `Last updates | land: ${newCursors.land} - rentals: ${newCursors.rentals}`
    )

    return { ...batch, updatedAt, cursors: newCursors }
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

  function buildEstate(fragment: ParcelFragment): NFT | null {
    const {
      parcel: { estate },
    } = fragment
    if (!estate) return null

    const { size, parcels, tokenId, data } = estate
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
