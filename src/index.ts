import { setupRoutes } from './adapters/routes'
import { createApiComponent } from './modules/api/component'
import { createImageComponent } from './modules/image/component'
import { createMapComponent } from './modules/map/component'
import { AppComponents, AppConfig, GlobalContext } from './types'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent } from '@well-known-components/http-server'
import { createStatusCheckComponent } from '@well-known-components/http-server/dist/status-checks'
import { createLogComponent } from '@well-known-components/logger'
import { Lifecycle } from '@well-known-components/interfaces'

import { config as configDotEnvFile } from 'dotenv'
import { setupLogs } from './adapters/logs'

async function main(components: AppComponents) {
  const globalContext: GlobalContext = {
    components,
  }

  setupLogs(components)
  setupRoutes(globalContext)
}

async function initComponents(): Promise<AppComponents> {
  configDotEnvFile()

  // default config
  const defaultValues: Partial<AppConfig> = {
    HTTP_SERVER_PORT: '5000',
    HTTP_SERVER_HOST: '0.0.0.0',
    API_URL: 'https://api.thegraph.com/subgraphs/name/decentraland/marketplace',
    API_BATCH_SIZE: '1000',
    API_CONCURRENCY: '10',
    REFRESH_INTERVAL: '60',
  }

  const config = createConfigComponent<AppConfig>(process.env, defaultValues)
  const logs = createLogComponent()
  const server = await createServerComponent(
    { config, logs },
    { cors: {}, compression: {} }
  )
  const statusChecks = await createStatusCheckComponent({ server })
  const api = await createApiComponent({ config, logs })
  const map = await createMapComponent({ config, api, logs })
  const image = await createImageComponent({ map })

  return {
    config,
    api,
    map,
    server,
    logs,
    image,
    statusChecks,
  }
}

Lifecycle.programEntryPoint({
  main,
  initComponents,
})
