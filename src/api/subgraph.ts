import future from 'fp-future'
import fetch from 'isomorphic-fetch'

import specialTilesJson from '../data/specialTiles.json'
import { TileType } from '../types'
import { coordsToId, idToCoords } from '../utils'

const specialTiles = specialTilesJson as Record<string, SpecialTile>

export type SubgraphTile = {
  id: string
  x: number
  y: number
  owner: string | null
  estateId: string | null
  type: TileType
  name: string
  top: boolean
  left: boolean
  topLeft: boolean
  tokenId: string | null
  updatedAt: number
}

const fields = `{ 
  name,
  owner { 
    id 
  }, 
  searchParcelX,
  searchParcelY,
  searchParcelEstateId,
  tokenId,
  updatedAt
}`

type Fragment = {
  name: string | null
  owner: { id: string } | null
  searchParcelX: string
  searchParcelY: string
  searchParcelEstateId: string | null
  tokenId: string
  updatedAt: string
}

type SpecialTile = {
  id: string
  type: TileType.PLAZA | TileType.ROAD | TileType.DISTRICT
  top: boolean
  left: boolean
  topLeft: boolean
}

export class Subgraph {
  constructor(
    public url: string,
    public concurrency = 10,
    public batchSize = 1000
  ) {}

  // returns all the parcels in the map
  async fetchTiles(onProgress?: (progress: number) => void) {
    const tiles: Record<string, SubgraphTile> = {}

    // auxiliars for fetching in batches
    let batches: Promise<SubgraphTile[]>[] = []
    let total = 0
    let complete = false
    let lastTokenId = ''

    while (!complete) {
      // fetch batch
      const batch = this.fetchBatch(lastTokenId, batches.length).then(
        (result) => {
          // merge results
          for (const tile of result) {
            tiles[tile.id] = tile
          }

          // notify progress
          total = total + result.length
          const progress = ((total / 90601) * 100) | 0 // there are 301x301=90601 parcels in the world
          onProgress && onProgress(Math.min(100, progress))

          // resolve
          return result
        }
      )

      // when max concurrency is reached...
      batches.push(batch)
      if (batches.length === Math.max(this.concurrency, 1)) {
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
    onProgress && onProgress(100)

    // add missing special parcels (for instane in ropsten most of the roads and plazas have never been minted at all)
    for (const id of Object.keys(specialTiles)) {
      if (id in tiles) continue
      tiles[id] = this.fromSpecialTile(id, specialTiles[id])
    }

    // compute estates before resolving
    return this.computeEstates(tiles)
  }

  private async query<T>(query: string, retryDelay = 500) {
    try {
      const result: { data: T } = await fetch(this.url, {
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
          this.query<T>(query, retryDelay * 2).then((result) =>
            retry.resolve(result)
          ),
        retryDelay
      )
      return retry
    }
  }

  private async fetchBatch(lastTokenId = '', page = 0) {
    const { nfts } = await this.query<{ nfts: Fragment[] }>(
      `{ 
        nfts(
          first: ${this.batchSize}, 
          skip: ${this.batchSize * page}, 
          orderBy: tokenId, 
          orderDirection: asc, 
          where: {
            ${lastTokenId ? `tokenId_gt: "${lastTokenId}",` : ''} 
            category: parcel 
          }
        ) ${fields} 
      }`
    )
    return nfts.map(this.fromFragment)
  }

  private fromFragment(fragment: Fragment): SubgraphTile {
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
    }
  }

  private fromSpecialTile(i_d: string, specialTile: SpecialTile): SubgraphTile {
    if (!specialTile.id) {
      console.log(i_d)
    }
    const [x, y] = idToCoords(specialTile.id || i_d)
    const name = specialTile.type[0].toUpperCase() + specialTile.type.slice(1)
    return {
      ...specialTile,
      x,
      y,
      name,
      owner: null,
      estateId: null,
      tokenId: null,
      updatedAt: Date.now(),
    }
  }

  // watch out! this method performs mutations
  computeEstates(tiles: Record<string, SubgraphTile>) {
    // get bounds
    const keys = Object.keys(tiles)
    const bounds = keys.reduce(
      (bounds, key) => {
        const [x, y] = idToCoords(key)
        if (x < bounds.minX) bounds.minX = x
        if (x > bounds.maxX) bounds.maxX = x
        if (y < bounds.minY) bounds.minY = y
        if (y > bounds.maxY) bounds.maxY = y
        return bounds
      },
      { minX: 0, minY: 0, maxX: 0, maxY: 0 }
    )

    // loop within bounds
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      for (let y = bounds.minY; y <= bounds.maxY; y++) {
        const id = coordsToId(x, y)
        const tile = tiles[id]
        if (tile && tile.type === TileType.OWNED && tile.estateId) {
          // stitch tiles together if they belong to the same estate
          const topId = coordsToId(x, y + 1)
          const leftId = coordsToId(x - 1, y)
          const topLeftId = coordsToId(x - 1, y + 1)

          const topTile = tiles[topId]
          const leftTile = tiles[leftId]
          const topLeftTile = tiles[topLeftId]

          // mutations ahead! we are mutating here because it's way faster than recreating thousands of objects
          tile.top = topTile ? topTile.estateId === tile.estateId : false
          tile.left = leftTile ? leftTile.estateId === tile.estateId : false
          tile.topLeft = topLeftTile
            ? topLeftTile.estateId === tile.estateId
            : false
        }
      }
    }

    return tiles
  }

  async fetchUpdatedTiles(updatedAfter: number) {
    const { nfts } = await this.query<{ nfts: Fragment[] }>(`
      { 
        nfts(
          first: ${this.batchSize}, 
          orderBy: updatedAt, 
          orderDirection: asc, 
          where: { 
            updatedAt_gt: "${updatedAfter}", 
            category: parcel 
          }
        ) ${fields} 
      }`)
    return nfts.map(this.fromFragment)
  }
}
