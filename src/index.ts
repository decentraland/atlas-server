import cors from 'cors'
import compression from 'compression'
import { setupLogs } from './adapters/logs'
import { setupRoutes } from './adapters/routes'
import { createApiComponent } from './modules/api/component'
import { createConfigComponent } from './modules/config/component'
import { createImageComponent } from './modules/image/component'
import { createLogComponent } from './modules/log/component'
import { createMapComponent } from './modules/map/component'
import { createServerComponent } from './modules/server/component'
import { createRedirectComponent } from './modules/redirect/component'
import { AppComponents, AppConfig } from './types'

async function main() {
  // default config
  const defaultValues: Partial<AppConfig> = {
    PORT: 5000,
    HOST: '0.0.0.0',
    API_URL: 'https://api.thegraph.com/subgraphs/name/decentraland/marketplace',
    API_BATCH_SIZE: 1000,
    API_CONCURRENCY: 10,
    REFRESH_INTERVAL: 60,
    REDIRECT_URL:
      'https://land-api.decentraland.org',
  }

  const components = initComponents(defaultValues)
  initAdapters(components)
}

function initComponents(defaultValues: Partial<AppConfig>): AppComponents {
  const config = createConfigComponent<AppConfig>(process.env, defaultValues)
  const api = createApiComponent({ config })
  const map = createMapComponent({ config, api })
  const server = createServerComponent({ config })
  const log = createLogComponent()
  const image = createImageComponent({ map })
  const redirect = createRedirectComponent({ config })

  return {
    config,
    api,
    map,
    server,
    log,
    image,
    redirect,
  }
}

async function initAdapters(components: AppComponents) {
  const { map, server } = components

  setupLogs(components)

  server.use(cors())
  server.use(compression())

  setupRoutes(components)

  await server.start()
  map.init()
}

main().catch((error) => console.error(error.message))
