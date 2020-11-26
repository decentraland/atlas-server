import { createApiComponent } from '../api/component'
import { createConfigComponent } from '../config/component'
import { createMapComponent } from '../map/component'
import { createServerComponet } from '../server/component'
import { AppConfig, IAppComponent } from './types'

export function createAppComponent(): IAppComponent {
  // default config
  const defaultValues: Partial<AppConfig> = {
    PORT: 5000,
    HOST: '0.0.0.0',
    API_URL: 'https://api.thegraph.com/subgraphs/name/decentraland/marketplace',
    API_BATCH_SIZE: 1000,
    API_CONCURRENCY: 10,
    REFRESH_INTERVAL: 60,
  }

  // create components
  const config = createConfigComponent<AppConfig>(process.env, defaultValues)
  const api = createApiComponent({ config })
  const map = createMapComponent({ config, api })
  const server = createServerComponet({ config, map })

  return {
    config,
    api,
    map,
    server,
  }
}
