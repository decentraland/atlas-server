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
/** Where the next incremental fetch resumes, one cursor per source. */
export type Cursors = {
  /** Timestamp (seconds) of the subgraph head when the last land fetch started; the next one re-reads a window before it. */
  land: number
  /** Signatures server updatedAt (ms) of the newest rental listing change applied. */
  rentals: number
}

export type Result = Batch & {
  /** UTC ms of the newest of both cursors, the land one converted to ms. */
  updatedAt: number
  cursors: Cursors
  /** True when the full sweep of open rental listings ran and was applied. */
  rentalsSwept?: boolean
}

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
  /**
   * Fetches the land and rental listing changes after the given cursors.
   * @throws When the land changes can't be fetched; a rental listings failure keeps their cursor.
   */
  fetchUpdatedData: (
    cursors: Cursors,
    oldTiles: Record<string, Tile>,
    options?: { sweepRentals?: boolean }
  ) => Promise<Result>
  getDissolvedEstate: (estateId: string) => Promise<NFT | null>
}

export type OrderFragment = {
  price: string
  /** The time in milliseconds when the order expires */
  expiresAt: string
  /** The time in seconds when the order was created */
  createdAt?: string
}

export type EstateFragment = {
  id: string
  tokenId: string
  name: string | null
  updatedAt: string
  estate: {
    size: number | null
    data: {
      description: string | null
    } | null
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
