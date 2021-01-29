import { SingleBar } from 'cli-progress'
import { ApiEvents } from '../modules/api/types'
import { MapEvents, Tile } from '../modules/map/types'
import { ServerEvents } from '../modules/server/types'
import { AppComponents } from '../types'

export const setupLogs = (
  components: Pick<AppComponents, 'config' | 'server' | 'map' | 'api'>
) => {
  const { config, server, map, api } = components

  const bar = new SingleBar({ format: '[{bar}] {percentage}%' })

  server.events.on(ServerEvents.READY, () =>
    console.log(`Listening on port ${5000}`)
  )

  map.events.on(MapEvents.INIT, () => {
    console.log(`Fetching data...`)
    console.log(`URL: ${config.getString('API_URL')}`)
    console.log(`Concurrency: ${config.getString('API_CONCURRENCY')}`)
    console.log(`Batch Size: ${config.getString('API_BATCH_SIZE')}`)
    bar.start(100, 0)
  })

  api.events.on(ApiEvents.PROGRESS, (progress: number) => bar.update(progress))

  map.events.on(MapEvents.READY, (tiles: Tile[]) => {
    bar.stop()
    console.log(`Total: ${tiles.length.toLocaleString()} parcels`)
    console.log(
      `Polling changes every ${config.getNumber('REFRESH_INTERVAL')} seconds`
    )
  })

  map.events.on(MapEvents.UPDATE, (newTiles: Tile[]) =>
    console.log(`Updating ${newTiles.length} parcels: ${newTiles.map(tile => `${tile.x},${tile.y}`).join(', ')}`)
  )

  server.events.on(ServerEvents.ERROR, (error: Error) =>
    console.log(`Error: ${error.message}`)
  )
}
