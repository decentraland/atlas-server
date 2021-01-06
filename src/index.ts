import { setupRoutes } from './adapters/routes'
import { createApiComponent } from './ports/api/component'
import { createMapComponent } from './ports/map/component'
import { AppComponents, AppConfig, GlobalContext } from './types'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
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

  return {
    config,
    api,
    map,
    server,
    logs,
    statusChecks,
  }
}

Lifecycle.programEntryPoint({
  main,
  initComponents,
})
