import { EventEmitter } from 'events'
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
  id: string
  x: number
  y: number
  type: TileType
  top: boolean
  left: boolean
  topLeft: boolean
  updatedAt: number
  name?: string
  owner?: string
  estateId?: string
  tokenId?: string
  price?: number
  expiresAt?: number
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
  'expiresAt'
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
}
