import 'isomorphic-fetch'
import future from 'fp-future'
import { Tile, TileType } from '../map/types'
import { coordsToId, specialTiles } from '../map/utils'
import {
  TileFragment,
  OrderFragment,
} from './types'

// helper to do GraphQL queries with retry logic
export async function graphql<T>(url: string, query: string, retryDelay = 500) {
  try {
    const result: { data: T } = await fetch(url, {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
      }),
    }).then((resp) => resp.json())
    if (!result || !result.data || Object.keys(result.data).length === 0) {
      throw new Error('Invalid response')
    }
    return result.data
  } catch (error) {
    // retry
    const retry = future<T>()
    setTimeout(
      () =>
        // duplicate delay time on each attempt
        graphql<T>(url, query, retryDelay * 2).then((result) =>
          retry.resolve(result)
        ),
      retryDelay
    )
    return retry
  }
}

function isExpired(order: OrderFragment) {
  return parseInt(order.expiresAt) <= Date.now()
}

// helper to convert a TileFragment into a Tile
export function fromTileFragment(fragment: TileFragment): Tile {
  const {
    owner: parcelOwner,
    name: parcelName,
    contractAddress,
    searchParcelX,
    searchParcelY,
    searchParcelEstateId,
    tokenId,
    updatedAt: parcelUpdatedAt,
    activeOrder: parcelActiveOrder,
    parcel: { estate, data: parcelData },
  } = fragment


  const x = parseInt(searchParcelX)
  const y = parseInt(searchParcelY)
  const id = coordsToId(x, y)

  // special tiles are plazas, districts and roads
  const specialTile = id in specialTiles ? specialTiles[id] : null

  const name = (specialTile && specialTile.name) || (estate && estate.nft.name) || parcelName
  const owner = (estate && estate.nft.owner) || parcelOwner
  const activeOrder = (estate && estate.nft.activeOrder) || parcelActiveOrder
  const updatedAt = (estate && estate.nft.updatedAt) || parcelUpdatedAt


  const tile: Tile = {
    id,
    x,
    y,
    updatedAt: parseInt(updatedAt),
    type: specialTile
      ? specialTile.type
      : owner
        ? TileType.OWNED
        : TileType.UNOWNED,
    top: specialTile ? specialTile.top : false,
    left: specialTile ? specialTile.left : false,
    topLeft: specialTile ? specialTile.topLeft : false,
    parcel: { name: parcelName, description: parcelData && parcelData.description, contractAddress, tokenId }
  }

  if (name) {
    tile.name = name
  }

  if (searchParcelEstateId && estate) {
    tile.estateId = searchParcelEstateId.split('-').pop()! // estate-0xdeadbeef-<id>
    tile.estate = { contractAddress: estate.nft.contractAddress, tokenId: estate.nft.tokenId, size: estate.size, name: estate.nft.name, description: estate.data.description }
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
