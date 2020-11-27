import { EventEmitter } from 'events'
import express, { Request, Response } from 'express'
import cors from 'cors'
import future from 'fp-future'
import { IConfigComponent } from '../config/types'
import {
  IRequestHandler,
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
  app.use(cors())

  // methods
  function handle<T>(handler: IRequestHandler<T>) {
    return (req: Request, res: Response) => {
      const request = {
        url: req.url,
        method: req.method,
        path: req.path,
        query: req.query as Record<string, string | string[]>,
        params: req.params,
      }
      events.emit(ServerEvents.REQUEST, request)
      handler(request)
        .then((data) =>
          res.status(data.status).json({ ok: true, data: data.body })
        )
        .catch((error) => {
          res.status(500).send({ ok: false, error })
          events.emit(ServerEvents.ERROR, error)
        })
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
    get: (path, handler) => app.get(path, handler),
    post: (path, handler) => app.post(path, handler),
    put: (path, handler) => app.put(path, handler),
    delete: (path, handler) => app.delete(path, handler),
  }
}
