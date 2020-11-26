import { EventEmitter } from 'events'

export type ServerConfig = {
  PORT: number
  HOST: string
}

export enum ServerEvents {
  READY = 'ready',
}

export type IServerComponent = {
  events: EventEmitter
  start: () => void
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
