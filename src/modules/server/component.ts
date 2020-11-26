import { EventEmitter } from 'events'
import express from 'express'
import cors from 'cors'
import future from 'fp-future'
import { IAppComponent } from '../app/types'
import { handle, toLegacyTiles } from './utils'
import { IServerComponent, ServerEvents } from './types'

export function createServerComponet(
  components: Pick<IAppComponent, 'config' | 'map'>
): IServerComponent {
  const { config, map } = components

  // config
  const port = config.getNumber('PORT')
  const host = config.getString('HOST')

  // events
  const events = new EventEmitter()

  // server
  const app = express()
  app.use(cors())

  // mount
  app.get(
    '/v1/tiles',
    handle(async () => {
      const tiles = await map.getTiles()
      return toLegacyTiles(tiles)
    })
  )
  app.get('/v2/tiles', handle(map.getTiles))

  // methods
  async function start() {
    const listen = future()
    app.listen(port, host, () => listen.resolve(true))
    await listen
    events.emit(ServerEvents.READY, port)
    map.init()
  }

  return {
    events,
    start,
  }
}
