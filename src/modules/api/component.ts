import { EventEmitter } from 'events'

import { Tile } from '../map/types'
import { IConfigComponent } from '../config/types'
import {
  ApiConfig,
  ApiEvents,
  TileFragment,
  IApiComponent,
  NFTFragment,
} from './types'
import { fromNFTFragment, fromTileFragment, graphql } from './utils'

const tileFields = `{ 
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
    estate {
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

const nftFields = `{
  name
  category
  tokenId
  contractAddress
  parcel {
    x 
    y
    data {
      description
    }
  }
  estate {
    size
    parcels { 
      x
      y 
    }
    data {
      description
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
    const { nfts } = await graphql<{ nfts: TileFragment[] }>(
      url,
      `{ 
        nfts(
          first: ${batchSize}, 
          orderBy: updatedAt, 
          orderDirection: asc, 
          where: { 
            updatedAt_gt: "${updatedAfter}", 
            category: parcel 
          }
        ) ${tileFields} 
      }`
    )
    return nfts.map(fromTileFragment)
  }

  async function fetchParcel(x: string, y: string) {
    const { nfts } = await graphql<{ nfts: NFTFragment[] }>(
      url,
      `{ 
        nfts(
          first: 1,
          where: { 
            category: parcel,
            searchParcelX: "${x}",
            searchParcelY: "${y}"
          }
        ) ${nftFields} 
      }`
    )

    return nfts.length > 0 ? fromNFTFragment(nfts[0]) : null
  }

  async function fetchEstate(id: string) {
    const { nfts } = await graphql<{ nfts: NFTFragment[] }>(
      url,
      `{ 
        nfts(
          first: 1,
          where: { 
            category: estate,
            tokenId: "${id}",
            searchEstateSize_gt: 0
          }
        ) ${nftFields} 
      }`
    )

    return nfts.length > 0 ? fromNFTFragment(nfts[0]) : null
  }

  async function fetchToken(contractAddress: string, tokenId: string) {
    const { nfts } = await graphql<{ nfts: NFTFragment[] }>(
      url,
      `{ 
        nfts(
          first: 1,
          where: { 
            contractAddress: "${contractAddress.toLowerCase()}",
            tokenId: "${tokenId.toLowerCase()}",
            searchEstateSize_gt: 0
          }
        ) ${nftFields} 
      }`
    )
    return nfts.length > 0 ? fromNFTFragment(nfts[0]) : null
  }

  return {
    events,
    fetchTiles,
    fetchUpdatedTiles,
    fetchParcel,
    fetchEstate,
    fetchToken,
  }
}
