import 'isomorphic-fetch'
import future from 'fp-future'
import { Tile, TileType } from '../map/types'
import { coordsToId, specialTiles } from '../map/utils'
import {
  TileFragment,
  OrderFragment,
  Proximity,
  NFTFragment,
  NFT,
  Attribute,
} from './types'
import proximities from './data/proximity.json'

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
  const updatedAt = (estate && estate.nft.updatedAt) || parcelUpdatedAt

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
  }

  if (tokenId) {
    tile.tokenId = tokenId
  }

  return tile
}

export function fromNFTFragment(fragment: NFTFragment): NFT {
  const { category, name, parcel, estate, tokenId, contractAddress } = fragment
  switch (category) {
    case 'parcel': {
      const { x, y } = parcel!
      const attributes: Attribute[] = [
        {
          trait_type: 'X',
          value: parseInt(x, 10),
          display_type: 'number',
        },
        {
          trait_type: 'Y',
          value: parseInt(y, 10),
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
        name: name || `Parcel ${x},${y}`,
        description: (parcel!.data && parcel!.data.description) || '',
        image: `https://api.decentraland.org/v1/parcels/${x}/${y}/map.png?size=24&width=1024&height=1024`,
        external_url: `https://market.decentraland.org/contracts/${contractAddress}/tokens/${tokenId}`,
        attributes,
      }
    }
    case 'estate': {
      const { size, parcels } = estate!
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
        name,
        description: (estate!.data && estate!.data.description) || '',
        image: `https://api.decentraland.org/v1/estates/${tokenId}/map.png?size=24&width=1024&height=1024`,
        external_url: `https://market.decentraland.org/contracts/${contractAddress}/tokens/${tokenId}`,
        attributes,
      }
    }
  }
}

export const getProximity = (
  coords: { x: number | string; y: number | string }[]
) => {
  let proximity: Proximity | undefined
  for (const { x, y } of coords) {
    const id = x + ',' + y
    const coordProximity = (proximities as Record<string, Proximity>)[id]
    if (coordProximity) {
      if (proximity === undefined) {
        proximity = {}
      }
      if (
        coordProximity.district !== undefined &&
        (proximity.district === undefined ||
          coordProximity.district < proximity.district)
      ) {
        proximity.district = coordProximity.district
      }
      if (
        coordProximity.plaza !== undefined &&
        (proximity.plaza === undefined ||
          coordProximity.plaza < proximity.plaza)
      ) {
        proximity.plaza = coordProximity.plaza
      }
      if (
        coordProximity.road !== undefined &&
        (proximity.road === undefined || coordProximity.road < proximity.road)
      ) {
        proximity.road = coordProximity.road
      }
    }
  }
  return proximity
}

function capitalize(text: string) {
  return text[0].toUpperCase() + text.slice(1)
}
