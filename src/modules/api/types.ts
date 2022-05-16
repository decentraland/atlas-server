import { EventEmitter } from 'events'
import { Tile } from '../map/types'

export type ApiConfig = {
  API_URL: string
  API_BATCH_SIZE: number
  API_CONCURRENCY: number
  IMAGE_BASE_URL: string
  EXTERNAL_BASE_URL: string
  LAND_CONTRACT_ADDRESS: string
  ESTATE_CONTRACT_ADDRESS: string
}

export enum ApiEvents {
  PROGRESS = 'progress',
  INSERT_BATCH_TILES = 'insert_batch_tiles',
  INSERT_BATCH_PARCELS = 'insert_batch_parcels',
  INSERT_BATCH_ESTATES = 'insert_batch_estates',
  LAST_UPDATED_AT = 'last_updated_at'
}

export type Batch = { tiles: Tile[]; parcels: NFT[]; estates: NFT[] }
export type Result = Batch & { updatedAt: number }

export type NFT = {
  id: string
  name: string
  description: string
  image: string
  external_url: string
  background_color: string
  attributes: Attribute[]
}

export type Attribute = {
  trait_type: string
  value: number
  display_type: 'number'
}

export interface IApiComponent {
  events: EventEmitter
  fetchData: () => Promise<Result>
  fetchUpdatedData: (updatedAfter: number) => Promise<Result>
}

export type OrderFragment = {
  price: string
  expiresAt: string
}

export type EstateFragment = {
  updatedAt: string
  estate: {
    parcels: {
      nft: ParcelFragment
    }[]
  }
}

export type ParcelFragment = {
  name: string | null
  owner: { id: string } | null
  searchParcelX: string
  searchParcelY: string
  searchParcelEstateId: string | null
  tokenId: string
  updatedAt: string
  activeOrder: OrderFragment | null
  parcel: {
    data: {
      name: string | null
      description: string | null
    } | null
    estate: {
      tokenId: string
      size: number
      parcels: { x: string; y: string }[]
      nft: {
        name: string
        description: string | null
        owner: { id: string } | null
        activeOrder: OrderFragment | null
        updatedAt: string
      }
    } | null
  }
}

export type Proximity = {
  district?: number
  road?: number
  plaza?: number
}
