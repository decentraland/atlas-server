import { SingleBar } from 'cli-progress'
import { ApiEvents } from './modules/api/types'
import { createAppComponent } from './modules/app/component'
import { MapEvents, Tile } from './modules/map/types'
import { ServerEvents } from './modules/server/types'

async function main() {
  const { config, api, map, server } = createAppComponent()

  // log events
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
    console.log(`Updating ${newTiles.length} parcels`)
  )

  // kick it
  await server.start()
}

main().catch((error) => console.error(error.message))
