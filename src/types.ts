import { ApiConfig, IApiComponent } from './modules/api/types'
import { IMapComponent, MapConfig } from './modules/map/types'
import { IImageComponent } from './modules/image/types'
import { IDistrictComponent } from './modules/district/types'
import {
  IConfigComponent,
  IHttpServerComponent,
  ILoggerComponent,
  IMetricsComponent,
} from '@well-known-components/interfaces'
import { metricDeclarations } from './metrics'
import { IFetchComponent } from '@well-known-components/http-server'

export type GlobalContext = {
  components: BaseComponents
}

export type AppConfig = ApiConfig & MapConfig

export type BaseComponents = {
  config: IConfigComponent
  api: IApiComponent
  map: IMapComponent
  server: IHttpServerComponent<GlobalContext>
  logs: ILoggerComponent
  image: IImageComponent
  district: IDistrictComponent
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  fetch: IFetchComponent
  statusChecks: {}
}

// production components
export type AppComponents = BaseComponents & {}

// test environment components
export type TestComponents = BaseComponents & {}
