import { EventEmitter } from 'events'
import { RentalListing } from '@dcl/schemas'
import {
  IConfigComponent,
  ILoggerComponent,
  IMetricsComponent,
} from '@well-known-components/interfaces'
import { ISubgraphComponent } from '@well-known-components/thegraph-component'
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
import { fromMillisecondsToSeconds } from '../../adapters/time'
import { Metrics } from '../../metrics'
import { Tile, TileType } from '../map/types'
import { coordsToId, specialTiles } from '../map/utils'
import { IRentalsComponent } from '../rentals/types'
import {
  ApiEvents,
  Batch,
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
    const tiles: Tile[] = []
    const parcels: NFT[] = []
    const estates: NFT[] = []

    // auxiliaries for fetching in batches

    let batches: Promise<Batch>[] = []
    let total = 0
    let complete = false
    let lastTokenId = ''

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
    return nfts.reduce<Batch>(
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
        return batch
      },
      { tiles: [], parcels: [], estates: [] }
    )
  }

  async function fetchUpdatedData(
    updatedAfter: number,
    oldTiles: Record<string, Tile>
  ) {
    try {
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
            updatedAt_gt: "${updatedAfter}",
            category: parcel
          }
        ) ${parcelFields}
        estates: nfts(
          first: ${batchSize},
          orderBy: updatedAt,
          orderDirection: asc,
          where: {
            updatedAt_gt: "${updatedAfter}",
            category: estate
          }
        ) {
          updatedAt
          estate {
            parcels {
              nft ${parcelFields}
            }
          }
        }
      }`
      )
      const updatedRentalListings =
        rentals.getUpdatedRentalListings(updatedAfter)

      let parcels: ParcelFragment[] = []
      let estates: EstateFragment[] = []
      let rentalListings: RentalListing[] = []
      // Gets the latest parcels, estates and rental listings.
      const [landsSettlement, rentalListingsSettlement] =
        await Promise.allSettled([updatedLand, updatedRentalListings])

      if (landsSettlement.status === 'fulfilled') {
        parcels = landsSettlement.value.parcels
        estates = landsSettlement.value.estates
        metrics.increment('dcl_map_update', { type: 'land', status: 'success' })
      } else {
        componentLogger.error(
          `Failed to retrieve updated information about the lands: ${landsSettlement.reason}`
        )
        metrics.increment('dcl_map_update', { type: 'land', status: 'failure' })
      }

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
      const rentalListingByNftId = rentalListings.reduce((acc, curr) => {
        acc[curr.nftId] =
          acc[curr.nftId] && acc[curr.nftId].updatedAt > curr.updatedAt
            ? acc[curr.nftId]
            : curr
        return acc
      }, {} as Record<string, RentalListing>)

      if (!parcels.length && !estates.length && !rentalListings.length) {
        return {
          tiles: [],
          parcels: [],
          estates: [],
          updatedAt: updatedAfter,
        }
      }

      // Gets the tiles by estate id to use them more efficiently later.
      const tilesByEstateId = Object.values(oldTiles).reduce((acc, curr) => {
        if (curr.estateId && acc[curr.estateId]) {
          acc[curr.estateId] = acc[curr.estateId].concat([curr])
        } else if (curr.estateId && !acc[curr.estateId]) {
          acc[curr.estateId] = [curr]
        }
        return acc
      }, {} as Record<string, Tile[]>)

      // Gets the tiles by token id to use them more efficiently later.
      const tilesByTokenId = Object.values(oldTiles).reduce((acc, curr) => {
        if (curr.tokenId) {
          acc[curr.tokenId] = curr
        }
        return acc
      }, {} as Record<string, Tile>)

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
            tilesByTokenId[tokenId]
          ) {
            return {
              ...tilesByTokenId[tokenId],
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
            tilesByTokenId
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
              tilesByTokenId
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

      const batch: Batch = {
        tiles: [...updatedTiles, ...updatedTilesFromEstates],
        parcels: [...updatedParcels, ...updatedParcelsFromEstates],
        estates: [...updatedEstates, ...updatedEstatesFromEstates],
      }

      const tilesLastUpdatedAt = batch.tiles.reduce<number>(
        (updatedAt, tile) => Math.max(updatedAt, tile.updatedAt),
        0
      )
      const estatesLastUpdatedAt = estates.reduce<number>(
        (updatedAt, estate) =>
          Math.max(updatedAt, parseInt(estate.updatedAt, 10)),
        0
      )
      const rentalListingsUpdatedAt = fromMillisecondsToSeconds(
        Object.values(rentalListingByNftId).reduce<number>(
          (updatedAt, rentalListing) =>
            Math.max(updatedAt, rentalListing.updatedAt),
          0
        )
      )

      // Gets the minimum last updated time or the original updatedAfter time.
      // Getting the minimum is required due to the rental listings being fetched multiple times, making
      // it possible to have an estate or parcel update in the meantime.
      const updatedAt = Math.max(
        Math.min(
          tilesLastUpdatedAt === 0 ? Number.MAX_VALUE : tilesLastUpdatedAt,
          estatesLastUpdatedAt === 0 ? Number.MAX_VALUE : estatesLastUpdatedAt,
          rentalListingsUpdatedAt === 0
            ? Number.MAX_VALUE
            : rentalListingsUpdatedAt
        ),
        updatedAfter
      )

      const result: Result = {
        ...batch,
        updatedAt,
      }

      return result
    } catch (e) {
      throw new Error(
        `Failed to fetch update data: ${
          isErrorWithMessage(e) ? e.message : 'Unknown error'
        }`
      )
    }
  }

  function buildTile(
    fragment: ParcelFragment,
    rentalListing?: TileRentalListing
  ): Tile {
    const {
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
      estate ? parseInt(estate.nft.updatedAt, 10) : 0,
      parseInt(parcelUpdatedAt, 10)
    )

    // special tiles are plazas, districts and roads
    const specialTile = id in specialTiles ? specialTiles[id] : null

    const tile: Tile = {
      id,
      x,
      y,
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
      tile.expiresAt = Math.round(parseInt(activeOrder.expiresAt, 10) / 1000)
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
      return {
        id: estateId,
        name: nft.name,
        description: nft.estate.data?.description || '',
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
    } else {
      return null
    }
  }

  return {
    events,
    fetchData,
    fetchUpdatedData,
    getDissolvedEstate,
  }
}
