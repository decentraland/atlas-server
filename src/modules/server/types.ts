import { EventEmitter } from 'events'
import { RequestHandler } from 'express'

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
  handle: <T>(handler: IRequestHandler<T>) => RequestHandler
  get: (path: string, handler: RequestHandler) => void
  post: (path: string, handler: RequestHandler) => void
  put: (path: string, handler: RequestHandler) => void
  delete: (path: string, handler: RequestHandler) => void
}
