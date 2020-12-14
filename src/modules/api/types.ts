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

export type Fragment = {
  name: string | null
  owner: { id: string } | null
  searchParcelX: string
  searchParcelY: string
  searchParcelEstateId: string | null
  tokenId: string
  updatedAt: string
  activeOrder: OrderFragment | null
  parcel: {
    estate: {
      nft: {
        name: string
        owner: { id: string } | null
        activeOrder: OrderFragment | null
        updatedAt: string
      }
    } | null
  }
}
