import { EventEmitter } from 'events'

import { Tile } from '../map/types'
import { IConfigComponent } from '../config/types'
import {
  ApiConfig,
  ApiEvents,
  TileFragment,
  IApiComponent,
} from './types'
import { fromTileFragment, graphql } from './utils'

const tileFields = `{
  name
  contractAddress
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
      description
    }
    estate {
      size
      data {
        description
      }
      nft {
        contractAddress
        tokenId
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

export function createApiComponent(components: {
  config: IConfigComponent<ApiConfig>
}): IApiComponent {
  const { config } = components

  // config
  const url = config.getString('API_URL')
  const batchSize = config.getNumber('API_BATCH_SIZE')
  const concurrency = config.getNumber('API_CONCURRENCY')

  // events
  const events = new EventEmitter()

  // methods
  async function fetchTiles() {
    const tiles: Tile[] = []

    // auxiliars for fetching in batches
    let batches: Promise<Tile[]>[] = []
    let total = 0
    let complete = false
    let lastTokenId = ''

    while (!complete) {
      // fetch batch
      const batch = fetchBatch(lastTokenId, batches.length).then((result) => {
        // merge results
        for (const tile of result) {
          tiles.push(tile)
        }

        // notify progress
        total = total + result.length
        const progress = ((total / 90601) * 100) | 0 // there are 301x301=90601 parcels in the world
        events.emit(ApiEvents.PROGRESS, Math.min(99, progress))

        // resolve
        return result
      })

      // when max concurrency is reached...
      batches.push(batch)
      if (batches.length === Math.max(concurrency, 1)) {
        // ...wait for all the batches to finish
        const results = await Promise.all(batches)

        // find last id
        lastTokenId = results
          .filter((result) => result.length > 0)
          .pop()!
          .pop()!.tokenId!

        // prepare next iteration
        complete = results.some((result) => result.length === 0)
        batches = []
      }
    }

    // final progress update
    events.emit(ApiEvents.PROGRESS, 100)

    return tiles
  }

  async function fetchBatch(lastTokenId = '', page = 0) {
    const { nfts } = await graphql<{ nfts: TileFragment[] }>(
      url,
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
          ) ${tileFields}
        }`
    )
    return nfts.map(fromTileFragment)
  }

  async function fetchUpdatedTiles(updatedAfter: number) {
    const { parcels, estates } = await graphql<{
      parcels: TileFragment[]
      estates: { estate: { parcels: { nft: TileFragment }[] } }[]
    }>(
      url,
      `{
        parcels: nfts(
          first: ${batchSize},
          orderBy: updatedAt,
          orderDirection: asc,
          where: {
            updatedAt_gt: "${updatedAfter}",
            category: parcel
          }
        ) ${tileFields}
        estates: nfts(
          first: ${batchSize},
          orderBy: updatedAt,
          orderDirection: asc,
          where: {
            updatedAt_gt: "${updatedAfter}",
            category: estate
          }
        ) {
          estate {
            parcels {
              nft ${tileFields}
            }
          }
        }
      }`
    )
    const updatedTiles = parcels.map(fromTileFragment)

    // The following piece adds tiles from updated Estates. This is necessary only for an Estate that get listed or delisted on sale, since that doesn't chagne the lastUpdatedAt property of a Parcel.

    // keep track of tiles already added
    const tilesAlreadyAdded = new Set<string>(
      updatedTiles.map((tile) => tile.id)
    )
    // grab tiles from updated estates
    const updatedTilesFromEstates = estates
      .reduce<Tile[]>(
        (tiles, nft) => [
          ...tiles,
          ...nft.estate.parcels.map((parcel) => fromTileFragment(parcel.nft)),
        ],
        []
      )
      // remove duplicated tiles, if any
      .filter((tile) => !tilesAlreadyAdded.has(tile.id))

    return [...updatedTiles, ...updatedTilesFromEstates]
  }

  return {
    events,
    fetchTiles,
    fetchUpdatedTiles
  }
}
