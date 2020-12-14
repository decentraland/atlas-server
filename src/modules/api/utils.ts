import 'isomorphic-fetch'
import future from 'fp-future'
import { Tile, TileType } from '../map/types'
import { coordsToId, specialTiles } from '../map/utils'
import { Fragment, OrderFragment } from './types'

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

// helper to convert a Fragment into a Tile
export function fromFragment(fragment: Fragment): Tile {
  const {
    owner: parcelOwner,
    name: parcelName,
    searchParcelX,
    searchParcelY,
    searchParcelEstateId,
    tokenId,
    updatedAt: parcelUpdatedAt,
    activeOrder,
    parcel: { estate },
  } = fragment

  const estateName = (estate && estate.nft.name) || null
  const estateOwner = (estate && estate.nft.owner) || null
  const estateActiveOrder = estate ? estate.nft.activeOrder : null
  const estateUpdatedAt = (estate && estate.nft.updatedAt) || null

  const x = parseInt(searchParcelX)
  const y = parseInt(searchParcelY)
  const id = coordsToId(x, y)
  const owner = estateOwner || parcelOwner
  const name = estateName || parcelName
  const updatedAt = estateUpdatedAt || parcelUpdatedAt

  // special tiles are plazas, districts and roads
  const specialTile = id in specialTiles ? specialTiles[id] : null

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
  } else if (estateActiveOrder && !isExpired(estateActiveOrder)) {
    tile.price = Math.round(parseInt(estateActiveOrder.price) / 1e18)
  }

  if (tokenId) {
    tile.tokenId = tokenId
  }

  return tile
}
