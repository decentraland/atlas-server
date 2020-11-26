import 'isomorphic-fetch'
import future from 'fp-future'
import { Tile, TileType } from '../map/types'
import { coordsToId, specialTiles } from '../map/utils'
import { Fragment } from './types'

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

// helper to convert a Fragment into a Tile
export function fromFragment(fragment: Fragment): Tile {
  const {
    owner,
    name,
    searchParcelX,
    searchParcelY,
    searchParcelEstateId,
    tokenId,
    updatedAt,
  } = fragment

  const x = parseInt(searchParcelX, 10)
  const y = parseInt(searchParcelY, 10)
  const id = coordsToId(x, y)

  // special tiles are plazas, districts and roads
  const specialTile = id in specialTiles ? specialTiles[id] : null

  return {
    id,
    x,
    y,
    tokenId,
    updatedAt: parseInt(updatedAt, 10),
    name: name || `Parcel ${id}`,
    estateId: searchParcelEstateId
      ? searchParcelEstateId.split('-').pop()! //estate-0xdeadbeef-<id>
      : null,
    owner: owner ? owner.id : null,
    type: specialTile
      ? specialTile.type
      : owner
      ? TileType.OWNED
      : TileType.UNOWNED,
    top: specialTile ? specialTile.top : false,
    left: specialTile ? specialTile.left : false,
    topLeft: specialTile ? specialTile.topLeft : false,
    price: null,
  }
}
