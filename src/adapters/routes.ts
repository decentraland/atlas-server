import { AppComponents } from '../types'
import {
  createLegacyTilesRequestHandler,
  createMapPngRequestHandler,
  createTilesRequestHandler,
} from './handlers'

export function setupRoutes(
  components: Pick<AppComponents, 'server' | 'map' | 'image'>
) {
  const { server } = components
  server.get('/v1/tiles', createLegacyTilesRequestHandler(components))
  server.get('/v2/tiles', createTilesRequestHandler(components))
  server.get('/v1/map.png', createMapPngRequestHandler(components))
}
