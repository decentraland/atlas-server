import { EventEmitter } from 'events'

export type MapConfig = {
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
  init: () => void
  getTiles: () => Promise<Record<string, Tile>>
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
  name: string
  top: boolean
  left: boolean
  topLeft: boolean
  updatedAt: number
  owner: string | null
  estateId: string | null
  tokenId: string | null
  price: number | null
}

export type SpecialTile = {
  id: string
  type: TileType.PLAZA | TileType.ROAD | TileType.DISTRICT
  top: boolean
  left: boolean
  topLeft: boolean
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
