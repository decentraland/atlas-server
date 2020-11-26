import { IConfigComponent } from '../config/types'
import { ApiConfig, IApiComponent } from '../api/types'
import { IMapComponent, MapConfig } from '../map/types'
import { IServerComponent, ServerConfig } from '../server/types'

export type AppConfig = ApiConfig & MapConfig & ServerConfig

export interface IAppComponent {
  config: IConfigComponent<AppConfig>
  api: IApiComponent
  map: IMapComponent
  server: IServerComponent
}
