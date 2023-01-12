import { EventEmitter } from 'events'
import { TileRentalListing } from '../../adapters/rentals'
import { NFT } from '../api/types'

export type MapConfig = {
  LAND_CONTRACT_ADDRESS: string
  ESTATE_CONTRACT_ADDRESS: string
  REFRESH_INTERVAL: number
}

export enum MapEvents {
  INIT = 'init',
  READY = 'ready',
  UPDATE = 'update',
  ERROR = 'error',
}

export interface IMapComponent {
  events: EventEmitter
  getTiles: () => Promise<Record<string, Tile>>
  getParcel: (x: string | number, y: string | number) => Promise<NFT | null>
  getEstate: (id: string) => Promise<NFT | null>
  getDissolvedEstate: (id: string) => Promise<NFT | null>
  getToken: (contractAddress: string, tokenId: string) => Promise<NFT | null>
  isReady: () => boolean
  getLastUpdatedAt: () => number
}

export enum TileType {
  OWNED = 'owned',
  UNOWNED = 'unowned',
  PLAZA = 'plaza',
  ROAD = 'road',
  DISTRICT = 'district',
}

export type Tile = {
  /** The coordinate of the tile expressed as "x,y". */
  id: string
  /** The coordinate X of the tile. */
  x: number
  /** The coordinate Y of the tile. */
  y: number
  /** The tile type. */
  type: TileType
  /** True if it has a tile on its top. */
  top: boolean
  /** True if it has a tile on its left. */
  left: boolean
  /** True if it has a tile on its top left. */
  topLeft: boolean
  /** UTC timestamp in seconds of the last time the tile was updated. */
  updatedAt: number
  /** The name of the tile, taken either from the estate or from the parcel it belongs to. */
  name?: string
  /** The owner of the tile. */
  owner?: string
  /** The estate id, if the tile belongs to a state. */
  estateId?: string
  /** The estate id, if the tile represents a parcel. */
  tokenId?: string
  /** The price, in ethers of the parcel / estate order. */
  price?: number
  /** The UTC time in seconds of when the sell order expires. */
  expiresAt?: number
  /** The rental listing associated with the parcel ir represents or estate that the tile is in. */
  rentalListing?: TileRentalListing
}

export const tileFields = [
  'id',
  'x',
  'y',
  'type',
  'name',
  'top',
  'left',
  'topLeft',
  'updatedAt',
  'owner',
  'estateId',
  'tokenId',
  'price',
  'expiresAt',
]

export type SpecialTile = {
  id: string
  type: TileType.PLAZA | TileType.ROAD | TileType.DISTRICT
  top: boolean
  left: boolean
  topLeft: boolean
  name?: string
}

export type LegacyTile = {
  type: number
  x: number
  y: number
  owner?: string
  estate_id?: string
  name?: string
  top?: number
  left?: number
  topLeft?: number
  price?: number
  rentalPricePerDay?: string
}
