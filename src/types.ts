import { IApiComponent } from './modules/api/types'
import { IMapComponent } from './modules/map/types'
import { IDistrictComponent } from './modules/district/types'
import { IImageComponent } from './modules/image/types'
import { IS3Component } from './modules/s3/component'
import {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IMetricsComponent,
  ITracerComponent,
  IBaseComponent,
} from '@well-known-components/interfaces'
import { IRentalsComponent } from './modules/rentals/types'
import { ISubgraphComponent } from '@well-known-components/thegraph-component'
import { Metrics } from './metrics'
import { MiniMapRendererComponent } from './adapters/mini-map-renderer'

export type GlobalContext = {
  components: AppComponents
}

export type AppComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IHttpServerComponent<GlobalContext>
  metrics: IMetricsComponent<keyof Metrics>
  tracer: ITracerComponent
  subgraph: ISubgraphComponent
  rentals: IRentalsComponent
  api: IApiComponent
  batchApi: IApiComponent
  map: IMapComponent
  district: IDistrictComponent
  image: IImageComponent
  s3: IS3Component
  statusChecks: IBaseComponent
  renderMiniMap: MiniMapRendererComponent
  renderEstateMiniMap: MiniMapRendererComponent
}

export type TestComponents = AppComponents

export type Context<Path extends string = any> =
  IHttpServerComponent.PathAwareContext<GlobalContext, Path>
