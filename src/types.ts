import type { ApiConfig, IApiComponent } from './ports/api/types'
import type { IMapComponent, MapConfig } from './ports/map/types'
import type {
  IBaseComponent,
  IConfigComponent,
  IHttpServerComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'

export type AppConfig = ApiConfig & MapConfig & {
  HTTP_SERVER_PORT: string
  HTTP_SERVER_HOST: string
}

export type AppComponents = {
  config: IConfigComponent
  api: IApiComponent
  map: IMapComponent
  server: IHttpServerComponent
  logs: ILoggerComponent
  statusChecks: IBaseComponent
}

export type GlobalContext = {
  components: AppComponents
}