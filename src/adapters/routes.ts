import { AppComponents } from '../types'
import {
  createLegacyTilesRequestHandler,
  createTilesRequestHandler,
} from './handlers'

export function setupRoutes(components: Pick<AppComponents, 'server' | 'map'>) {
  const { server } = components
  server.get('/v1/tiles', createLegacyTilesRequestHandler(components))
  server.get('/v2/tiles', createTilesRequestHandler(components))
}
