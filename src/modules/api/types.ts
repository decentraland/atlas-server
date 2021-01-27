import { EventEmitter } from 'events'
import { Tile } from '../map/types'

export type ApiConfig = {
  API_URL: string
  API_BATCH_SIZE: number
  API_CONCURRENCY: number
}

export enum ApiEvents {
  PROGRESS = 'progress',
}

export interface IApiComponent {
  events: EventEmitter
  fetchTiles: () => Promise<Tile[]>
  fetchUpdatedTiles: (updatedAfter: number) => Promise<Tile[]>
}

export type OrderFragment = {
  price: string
  expiresAt: string
}

export type TileFragment = {
  name: string | null
  contractAddress: string
  owner: { id: string } | null
  searchParcelX: string
  searchParcelY: string
  searchParcelEstateId: string | null
  tokenId: string
  updatedAt: string
  activeOrder: OrderFragment | null
  parcel: {
    data: { description: string }
    estate: {
      data: { description: string }
      size: number
      nft: {
        tokenId: string
        contractAddress: string
        name: string
        owner: { id: string } | null
        activeOrder: OrderFragment | null
        updatedAt: string
      }
    } | null
  }
}