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

export type NFT = {
  name: string
  description: string
  image: string
  external_url: string
  attributes: Attribute[]
}

export type Attribute = {
  trait_type: string
  value: number
  display_type: 'number'
}

export interface IApiComponent {
  events: EventEmitter
  fetchTiles: () => Promise<Tile[]>
  fetchUpdatedTiles: (updatedAfter: number) => Promise<Tile[]>
  fetchParcel: (x: string, y: string) => Promise<NFT | null>
  fetchEstate: (id: string) => Promise<NFT | null>
  fetchToken: (contractAddress: string, tokenId: string) => Promise<NFT | null>
}

export type OrderFragment = {
  price: string
  expiresAt: string
}

export type TileFragment = {
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

export type NFTFragment = {
  name: string
  category: 'parcel' | 'estate'
  tokenId: string
  contractAddress: string
  parcel: {
    x: string
    y: string
    data: {
      description: string | null
    } | null
  } | null
  estate: {
    size: number
    parcels: {
      x: string
      y: string
    }[]
    data: {
      description: string | null
    } | null
  } | null
}

export type Proximity = {
  district?: number
  road?: number
  plaza?: number
}
