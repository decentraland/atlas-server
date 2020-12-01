import { EventEmitter } from 'events'
import express, { Request, Response } from 'express'
import future from 'fp-future'
import { IConfigComponent } from '../config/types'
import {
  IRequest,
  IRequestHandler,
  IResponse,
  IServerComponent,
  ServerConfig,
  ServerEvents,
} from './types'

export function createServerComponent(components: {
  config: IConfigComponent<ServerConfig>
}): IServerComponent {
  const { config } = components

  // config
  const port = config.getNumber('PORT')
  const host = config.getString('HOST')

  // events
  const events = new EventEmitter()

  // server
  const app = express()

  // methods
  function buildRequest(req: Request): IRequest {
    return {
      url: req.url,
      method: req.method,
      path: req.path,
      query: req.query as Record<string, string | string[]>,
      params: req.params,
    }
  }

  function success<T>(res: Response) {
    return (data: IResponse<T>) => {
      res.status(data.status).json({ ok: true, data: data.body })
    }
  }

  function failure(res: Response) {
    return (error: Error) => {
      res.status(500).send({ ok: false, error })
      events.emit(ServerEvents.ERROR, error)
    }
  }

  function handle<T>(handler: IRequestHandler<T>) {
    return (req: Request, res: Response) => {
      const request = buildRequest(req)
      events.emit(ServerEvents.REQUEST, request)
      handler(request).then(success(res)).catch(failure(res))
    }
  }

  function cache<T>(handler: IRequestHandler<T>, deps: any[] = []) {
    const cache: Record<string, { deps: any[]; response: IResponse<T> }> = {}
    return (req: Request, res: Response) => {
      const request = buildRequest(req)
      events.emit(ServerEvents.REQUEST, request)

      const key = req.originalUrl || req.url
      const data = cache[key]

      const currentDeps = deps.map((dep) => dep())

      if (data) {
        const isValid = !data.deps.some((dep, i) => dep !== currentDeps[i]) // check if any of the cached deps is different to the current deps
        if (isValid) {
          return success(res)(data.response)
        } else {
          delete cache[key] // clean cache if invalidated
        }
      }

      handler(request)
        .then((data) => {
          cache[key] = {
            deps: currentDeps,
            response: data,
          }
          success(res)(data)
        })
        .catch(failure(res))
    }
  }

  async function start() {
    const listen = future()
    app.listen(port, host, () => listen.resolve(true))
    await listen
    events.emit(ServerEvents.READY, port)
  }

  return {
    events,
    start,
    handle,
    cache,
    use: (handler) => app.use(handler),
    get: (path, handler) => app.get(path, handler),
    post: (path, handler) => app.post(path, handler),
    put: (path, handler) => app.put(path, handler),
    delete: (path, handler) => app.delete(path, handler),
  }
}
