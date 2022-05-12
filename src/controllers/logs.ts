import { SingleBar } from 'cli-progress'
import { AppDataSource } from '../data-source'
import { User } from '../entity/User'
import { ApiEvents, Result } from '../modules/api/types'
import { MapEvents } from '../modules/map/types'
import { AppComponents } from '../types'

export const setupLogs = (
  components: Pick<AppComponents, 'config' | 'map' | 'api'>
) => {
  const { config, map, api } = components

  const bar = new SingleBar({ format: '[{bar}] {percentage}%' })

  map.events.on(MapEvents.INIT, async () => {
    console.log(`Fetching data...`)
    // TODO: it may be better to ask configurations to the specific component like
    //     console.log(`URL: ${map.API_URL}`)
    // to avoid using config with hardcoded keys everywhere
    console.log(`URL: ${await config.getString('API_URL')}`)
    console.log(`Concurrency: ${await config.getString('API_CONCURRENCY')}`)
    console.log(`Batch Size: ${await config.getString('API_BATCH_SIZE')}`)
    bar.start(100, 0)
    AppDataSource.initialize().then(async () => {
      console.log("Inserting a new user into the database...")
      const user = new User()
      user.firstName = "Timber"
      user.lastName = "Saw"
      user.age = 25
      await AppDataSource.manager.save(user)
      console.log("Saved a new user with id: " + user.id)

      console.log("Loading users from the database...")
      const users = await AppDataSource.manager.find(User)
      console.log("Loaded users: ", users)

      console.log("Here you can setup and run express / fastify / any other framework.")

    }).catch(error => console.log(error))
  })

  api.events.on(ApiEvents.PROGRESS, (progress: number) => bar.update(progress))

  map.events.on(MapEvents.READY, async (result: Result) => {
    bar.stop()
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
