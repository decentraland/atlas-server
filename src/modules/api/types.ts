import { EventEmitter } from 'events'
import { Tile } from '../map/types'

export enum ApiEvents {
  PROGRESS = 'progress',
}

export type Batch = {
  tiles: Tile[]
  parcels: NFT[]
  estates: NFT[]
}
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
  fetchUpdatedData: (
    updatedAfter: number,
    oldTiles: Record<string, Tile>
  ) => Promise<Result>
  getDissolvedEstate: (estateId: string) => Promise<NFT | null>
}

export type OrderFragment = {
  price: string
  /** The time in milliseconds when the order expires */
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
  id: string
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
      size: number | null
      data: {
        description: string | null
      } | null
      parcels: { x: string; y: string }[]
      nft: {
        name: string
        owner: { id: string } | null
        activeOrder: OrderFragment | null
        updatedAt: string
      }
    } | null
  }
}

export type DissolvedEstateFragment = {
  name: string
  estate: {
    data: {
      description: string
    }
  }
}

export type Proximity = {
  district?: number
  road?: number
  plaza?: number
}
