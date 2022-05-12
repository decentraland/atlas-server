import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createMetricsComponent } from '@well-known-components/metrics'
import {
  createServerComponent,
  createStatusCheckComponent,
} from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createApiComponent } from './modules/api/component'
import { createDistrictComponent } from './modules/district/component'
import { createImageComponent } from './modules/image/component'
import { createMapComponent } from './modules/map/component'
import { AppComponents, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import { AppDataSource } from "./data-source"
import { User } from "./entity/User"

export async function initComponents(): Promise<AppComponents> {

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


  const config = await createDotEnvConfigComponent(
    { path: ['.env.defaults', '.env'] },
    process.env
  )

  const cors = {
    origin: await config.getString('CORS_ORIGIN'),
    method: await config.getString('CORS_METHOD'),
  }

  const api = await createApiComponent({ config })
  const map = await createMapComponent({ config, api })
  const logs = createLogComponent()
  const server = await createServerComponent<GlobalContext>(
    { config, logs },
    { cors, compression: {} }
  )
  const image = createImageComponent({ map })
  const district = createDistrictComponent()
  const metrics = await createMetricsComponent(metricDeclarations, {
    server,
    config,
  })
  const statusChecks = await createStatusCheckComponent({
    server,
    config
  })

  return {
    config,
    api,
    map,
    metrics,
    server,
    logs,
    image,
    district,
    statusChecks,
  }
}
