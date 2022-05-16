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
import { createDatabaseComponent } from './modules/database/component'

export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent(
    { path: ['.env.defaults', '.env'] },
    process.env
  )

  const cors = {
    origin: await config.getString('CORS_ORIGIN'),
    method: await config.getString('CORS_METHOD'),
  }

  const api = await createApiComponent({ config })
  const logs = createLogComponent()
  const database = await createDatabaseComponent({ events: api.events, config })
  const map = await createMapComponent({ config, database, api })
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
    database,
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
