import { EventEmitter } from 'events'
import {
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'

import { Tile } from '../map/types'
import { ApiEvents, Fragment, IApiComponent } from './types'
import { fromFragment, graphql } from './utils'

const fields = `{
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
        activeOrder {
          price
          expiresAt
        }
      }
    }
  }
}`

export async function createApiComponent(components: {
  config: IConfigComponent
  logs: ILoggerComponent
}): Promise<IApiComponent> {
  const { config, logs } = components
  const logger = logs.getLogger('api-component')

  // config
  const url = await config.requireString('API_URL')
  const batchSize = await config.requireNumber('API_BATCH_SIZE')
  const concurrency = await config.requireNumber('API_CONCURRENCY')

  logger.debug(`URL: ${await config.getString('API_URL')}`)
  logger.debug(`Concurrency: ${await config.getString('API_CONCURRENCY')}`)
  logger.debug(`Batch Size: ${await config.getString('API_BATCH_SIZE')}`)

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
        logger.debug(`Progress: ${Math.round(progress)}`)

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

    logger.debug(`Progress: Finished`)

    return tiles
  }

  async function fetchBatch(lastTokenId = '', page = 0) {
    const { nfts } = await graphql<{ nfts: Fragment[] }>(
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
        ) ${fields}
      }`
    )
    return nfts.map(fromFragment)
  }

  async function fetchUpdatedTiles(updatedAfter: number) {
    const { nfts } = await graphql<{ nfts: Fragment[] }>(
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
        ) ${fields}
      }`
    )
    return nfts.map(fromFragment)
  }

  return {
    events,
    fetchTiles,
    fetchUpdatedTiles,
  }
}
