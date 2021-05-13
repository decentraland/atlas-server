import { main } from '../../src/service'
import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import {
  createServerComponent,
  createStatusCheckComponent,
} from '@well-known-components/http-server'
import { createLogComponent } from '@well-known-components/logger'

import { GlobalContext, TestComponents } from '../../src/types'
import { metricDeclarations } from '../../src/metrics'
import { createMetricsComponent } from '@well-known-components/metrics'
import { createRunner } from '@well-known-components/test-helpers'
import { createApiComponent } from '../../src/modules/api/component'
import { createDistrictComponent } from '../../src/modules/district/component'
import { createImageComponent } from '../../src/modules/image/component'
import { createMapComponent } from '../../src/modules/map/component'
import { createTestFetchComponent } from './testFetchComponent'

let currentPort = 19000

// creates a "mocha-like" describe function to run tests using the test components
export const test = createRunner({
  main,
  initComponents,
})

async function initComponents(): Promise<TestComponents> {
  const logs = createLogComponent()

  const config = await createDotEnvConfigComponent(
    { path: ['.env.defaults', '.env'], debug: true },
    {
      HTTP_SERVER_PORT: (currentPort + 1).toString(),
      HTTP_SERVER_HOST: '0.0.0.0',
    }
  )

  const protocolHostAndProtocol = `http://${await config.requireString(
    'HTTP_SERVER_HOST'
  )}:${await config.requireNumber('HTTP_SERVER_PORT')}`

  const server = await createServerComponent<GlobalContext>(
    { logs, config },
    {}
  )
  const fetch = await createTestFetchComponent(protocolHostAndProtocol)

  const api = await createApiComponent({ config, fetch })
  const map = await createMapComponent({ config, api })
  const image = createImageComponent({ map })
  const district = createDistrictComponent()
  const statusChecks = await createStatusCheckComponent({ server })
  const metrics = await createMetricsComponent(metricDeclarations, {
    server,
    config,
  })

  return {
    logs,
    config,
    server,
    fetch,
    metrics,
    api,
    image,
    district,
    map,
    statusChecks,
  }
}
