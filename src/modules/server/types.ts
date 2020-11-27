import { EventEmitter } from 'events'

export type ServerConfig = {
  PORT: number
  HOST: string
}

export enum ServerEvents {
  READY = 'ready',
  REQUEST = 'request',
  ERROR = 'error',
}

export type IRequest<
  Query extends object = Record<string, string | string[]>,
  Params extends object = Record<string, string>
> = {
  method: string
  url: string
  path: string
  query: Query
  params: Params
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
