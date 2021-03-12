import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createServerComponent, createStatusCheckComponent } from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'
import { createApiComponent } from './modules/api/component'
import { createDistrictComponent } from './modules/district/component'
import { createImageComponent } from './modules/image/component'
import { createMapComponent } from './modules/map/component'
import { AppComponents, GlobalContext } from './types'
import * as dotenv from 'dotenv'
import { createMetricsComponent } from '@well-known-components/metrics'
import { metricDeclarations } from './metrics'

export async function initComponents(): Promise<AppComponents> {
  dotenv.config({ path: '.env.defaults' })
  const config = await createDotEnvConfigComponent({}, process.env)
  const api = await createApiComponent({ config })
  const map = await createMapComponent({ config, api })
  const logs = createLogComponent()
  const server = await createServerComponent<GlobalContext>({ config, logs }, {})
  const image = createImageComponent({ map })
  const district = createDistrictComponent()
  const metrics = await createMetricsComponent(metricDeclarations, { server, config })
  const statusChecks = await createStatusCheckComponent({ server })

  return {
    config,
    api,
    map,
    metrics,
    server,
    logs,
    image,
    district,
    statusChecks
  }
}
