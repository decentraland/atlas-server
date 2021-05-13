import { EventEmitter } from 'events'

import { Tile, TileType } from '../map/types'
import { IConfigComponent } from '@well-known-components/interfaces'
import {
  ApiEvents,
  Batch,
  ParcelFragment,
  IApiComponent,
  NFT,
  Attribute,
  EstateFragment,
  Result,
} from './types'
import {
  isExpired,
  getProximity,
  graphql,
  capitalize,
  buildFromEstates,
} from './utils'
import { coordsToId, specialTiles } from '../map/utils'
import { AppComponents } from '../../types'

const parcelFields = `{
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

export async function createApiComponent(
  components: Pick<AppComponents, 'config' | 'fetch'>
): Promise<IApiComponent> {
  const {
    config,
    fetch: { fetch },
  } = components

  // config
  const url = await config.requireString('API_URL')
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

  // events
  const events = new EventEmitter()

  // methods
  async function fetchData() {
    const tiles: Tile[] = []
    const parcels: NFT[] = []
    const estates: NFT[] = []

    // auxiliars for fetching in batches

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
        // find last id
        lastTokenId = results
          .map((batch) => batch.tiles)
          .filter((result) => result.length > 0)
          .pop()!
          .pop()!.tokenId!

        // prepare next iteration
        complete = results
          .map((batch) => batch.tiles)
          .some((result) => result.length === 0)
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
    const { nfts } = await graphql<{ nfts: ParcelFragment[] }>(
      fetch,
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
        ) ${parcelFields}
      }`
    )
    return nfts.reduce<Batch>(
      (batch, nft) => {
        const tile = buildTile(nft)
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

  async function fetchUpdatedData(updatedAfter: number) {
    try {
      const { parcels, estates } = await graphql<{
        parcels: ParcelFragment[]
        estates: EstateFragment[]
      }>(
        fetch,
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

      const updatedTiles = parcels.map(buildTile)
      const updatedParcels = parcels.map(buildParcel)
      const updatedEstates = parcels
        .map(buildEstate)
        .filter((estate) => estate !== null) as NFT[]

      // The following piece adds tiles from updated Estates. This is necessary only for an Estate that get listed or delisted on sale, since that doesn't change the lastUpdatedAt property of a Parcel.
      const updatedTilesFromEstates = buildFromEstates(
        estates,
        updatedTiles,
        buildTile
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

      const updatedAt = Math.max(tilesLastUpdatedAt, estatesLastUpdatedAt)

      const result: Result = {
        ...batch,
        updatedAt,
      }

      return result
    } catch (e) {
      throw new Error(`Failed to fetch update data: ${e.message}`)
    }
  }

  function buildTile(fragment: ParcelFragment): Tile {
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
    }

    if (tokenId) {
      tile.tokenId = tokenId
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

    const { size, parcels, tokenId } = estate
    const { name, description } = estate.nft
    const attributes: Attribute[] = [
      {
        trait_type: 'Size',
        value: size,
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
      description: description || '',
      image: `${imageBaseUrl}/estates/${tokenId}/map.png?size=24&width=1024&height=1024`,
      external_url: `${externalBaseUrl}/contracts/${estateContractAddress}/tokens/${tokenId}`,
      attributes,
      background_color: '000000',
    }
  }

  return {
    events,
    fetchData,
    fetchUpdatedData,
  }
}
