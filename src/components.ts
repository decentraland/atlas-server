import { createDotEnvConfigComponent } from '@well-known-components/env-config-provider'
import { createMetricsComponent } from '@dcl/metrics'
import {
  createServerComponent,
  createStatusCheckComponent,
  instrumentHttpServerWithPromClientRegistry,
} from '@dcl/http-server'
import { createFeaturesComponent } from '@dcl/features-component'
import { createSubgraphComponent } from '@dcl/thegraph-component'
import { createPgComponent } from '@dcl/pg-component'
import { createLogComponent } from '@well-known-components/logger'
import { createTracerComponent } from '@dcl/tracer-component'
import { createHttpTracerComponent } from '@dcl/http-tracer-component'
import { instrumentHttpServerWithRequestLogger } from '@dcl/http-requests-logger-component'
import { createTracedFetcherComponent } from '@dcl/traced-fetch-component'
import { createApiComponent } from './modules/api/component'
import { createDistrictComponent } from './modules/district/component'
import { createImageComponent } from './modules/image/component'
import { createMapComponent } from './modules/map/component'
import { createRentalsComponent } from './modules/rentals/component'
import { createTradesComponent } from './modules/trades/component'
import { AppComponents, GlobalContext } from './types'
import { metricDeclarations } from './metrics'
import {
  createEstatesRendererComponent,
  createMiniMapRendererComponent,
} from './adapters/mini-map-renderer'
import { createS3Component } from './modules/s3/component'
import { createRenderLimiterComponent } from './modules/render-limiter/component'
import { allowAnyOriginMiddleware } from './logic/allow-any-origin-middleware'

export async function initComponents(): Promise<AppComponents> {
  const config = await createDotEnvConfigComponent(
    { path: ['.env.defaults', '.env'] },
    process.env
  )

  const corsMethods = await config.getString('CORS_METHOD')
  const cors = {
    origin: await config.getString('CORS_ORIGIN'),
    methods: corsMethods
      ? corsMethods
          .split(',')
          .map((method) => method.trim())
          .filter(Boolean)
      : undefined,
  }
  const subgraphURL = await config.requireString('SUBGRAPH_URL')

  const metrics = await createMetricsComponent(metricDeclarations, {
    config,
  })
  const tracer = createTracerComponent()
  const logs = await createLogComponent({ metrics, tracer })
  // Native fetcher that propagates the active trace context. Replaces the
  // previous hand-rolled node-fetch fetcher that injected traceparent manually.
  const fetch = await createTracedFetcherComponent({ tracer })
  const batchLogs = {
    getLogger(name: string) {
      const logger = logs.getLogger(name)
      // We don't want to show info for each batched subgraph query
      return { ...logger, info: () => {} }
    },
  }

  const server = await createServerComponent<GlobalContext>(
    { config, logs },
    { cors }
  )
  if (!cors.origin || cors.origin === '*') {
    server.use(allowAnyOriginMiddleware({ logs }))
  }
  createHttpTracerComponent({ server, tracer })
  instrumentHttpServerWithRequestLogger({ server, logger: logs })

  await instrumentHttpServerWithPromClientRegistry({
    server,
    metrics,
    config,
    registry: metrics.registry!,
  })
  const subgraph = await createSubgraphComponent(
    { config, logs, fetch, metrics },
    subgraphURL
  )
  const batchSubgraph = await createSubgraphComponent(
    { config, logs: batchLogs, fetch, metrics },
    subgraphURL
  )
  const rentals = await createRentalsComponent({ config, fetch, logger: logs })
  const api = await createApiComponent({
    config,
    subgraph,
    rentals,
    logger: logs,
    metrics,
  })
  const batchApi = await createApiComponent({
    config,
    subgraph: batchSubgraph,
    rentals,
    logger: logs,
    metrics,
  })
  const s3 = await createS3Component({ config, logs })
  const dappsReadDatabase = await createPgComponent({ config, logs, metrics })
  const trades = await createTradesComponent({
    config,
    logs,
    dappsReadDatabase,
  })

  const map = await createMapComponent({
    config,
    api,
    batchApi,
    trades,
    tracer,
    s3,
    logs,
  })
  const image = createImageComponent({ map })
  const district = createDistrictComponent()
  const statusChecks = await createStatusCheckComponent({ server, config })
  const renderMiniMap = await createMiniMapRendererComponent({ map })
  const renderEstateMiniMap = await createEstatesRendererComponent({ map })
  const renderLimiter = await createRenderLimiterComponent({ config })
  const features = await createFeaturesComponent(
    {
      config,
      logs,
      fetch,
    },
    (await config.requireString('ATLAS_SERVER_URL')) ||
      `http://${await config.getString(
        'HTTP_SERVER_HOST'
      )}:${await config.getString('HTTP_SERVER_PORT')}`
  )

  return {
    config,
    api,
    batchApi,
    subgraph,
    map,
    metrics,
    server,
    logs,
    image,
    district,
    statusChecks,
    s3,
    tracer,
    rentals,
    renderMiniMap,
    renderEstateMiniMap,
    renderLimiter,
    features,
    dappsReadDatabase,
    trades,
  }
}
