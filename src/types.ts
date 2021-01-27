import { IConfigComponent } from './modules/config/types'
import { ApiConfig, IApiComponent } from './modules/api/types'
import { IMapComponent, MapConfig } from './modules/map/types'
import { IServerComponent, ServerConfig } from './modules/server/types'
import { ILogComponent } from './modules/log/types'
import { IImageComponent } from './modules/image/types'
import { IDistrictComponent } from './modules/district/types'
import { INFTComponent } from './modules/nft/types'


export type AppConfig = ApiConfig & MapConfig & ServerConfig

export type AppComponents = {
  config: IConfigComponent<AppConfig>
  api: IApiComponent
  map: IMapComponent
  server: IServerComponent
  log: ILogComponent
  image: IImageComponent
  district: IDistrictComponent
  nft: INFTComponent
}
