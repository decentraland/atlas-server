import { EventEmitter } from 'events'

export type ServerConfig = {
  PORT: number
  HOST: string
}

export enum ServerEvents {
  READY = 'ready',
}

export type IRequest = {
  path: string
  query: Record<string, string | string[]>
  params: Record<string, string>
}

export type IResponse<T> = {
  status: number
  body: T
}

export type IRequestHandler<T> = (req: IRequest) => Promise<IResponse<T>>

export type IServerComponent = {
  events: EventEmitter
  start: () => Promise<void>
  get: <T>(path: string, handler: IRequestHandler<T>) => void
  post: <T>(path: string, handler: IRequestHandler<T>) => void
  put: <T>(path: string, handler: IRequestHandler<T>) => void
  delete: <T>(path: string, handler: IRequestHandler<T>) => void
}
