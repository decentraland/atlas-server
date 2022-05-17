import { SingleBar } from 'cli-progress'
import { ApiEvents, Result } from '../modules/api/types'
import { MapEvents } from '../modules/map/types'
import { AppComponents } from '../types'

export const setupLogs = (
  components: Pick<AppComponents, 'config' | 'map' | 'api'>
) => {
  const { config, map, api } = components

  map.events.on(MapEvents.INIT, async () => {
    console.log(`Fetching data...`)
    // TODO: it may be better to ask configurations to the specific component like
    //     console.log(`URL: ${map.API_URL}`)
    // to avoid using config with hardcoded keys everywhere
    console.log(`URL: ${await config.getString('API_URL')}`)
    console.log(`Concurrency: ${await config.getString('API_CONCURRENCY')}`)
    console.log(`Batch Size: ${await config.getString('API_BATCH_SIZE')}`)
    console.log("0%")
  })

  api.events.on(ApiEvents.PROGRESS, (progress: number) => console.log(`${progress}%`))

  map.events.on(MapEvents.READY, async (result: Result) => {
    console.log("100%")
    console.log(`Total: ${result.tiles.length.toLocaleString()} tiles`)
    console.log(`Parcels: ${result.parcels.length.toLocaleString()}`)
    console.log(`Estates: ${result.estates.length.toLocaleString()}`)
    console.log(`Last timestamp:`, result.updatedAt)
    console.log(
      `Polling changes every ${await config.getNumber('REFRESH_INTERVAL')} seconds`
    )
  })

  map.events.on(MapEvents.UPDATE, (result: Result) => {
    console.log(
      `Updating ${result.tiles.length} tiles: ${result.tiles
        .map((tile) => `${tile.x},${tile.y}`)
        .join(', ')}`
    )
    console.log(`Updating ${result.parcels.length} parcels`)
    console.log(`Updating ${result.estates.length} estates`)
    console.log(`Last timestamp:`, result.updatedAt)
  })

  map.events.on(MapEvents.ERROR, (error: Error) => {
    console.log(
      `Error: updating tiles
       ${error.message}
       ${error.stack}`
    )
  })
}
