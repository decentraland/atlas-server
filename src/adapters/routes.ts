import { AppComponents } from '../types'
import {
  createEstateMapPngRequestHandler,
  createLegacyTilesRequestHandler,
  createMapPngRequestHandler,
  createParcelMapPngRequestHandler,
  createTilesRequestHandler,
} from './handlers'

export function setupRoutes(
  components: Pick<AppComponents, 'server' | 'map' | 'image'>
) {
  const { server } = components
  server.get('/v1/tiles', createLegacyTilesRequestHandler(components))
  server.get('/v2/tiles', createTilesRequestHandler(components))
  server.get('/v1/map.png', createMapPngRequestHandler(components))
  server.get(
    '/v1/parcels/:x/:y/map.png',
    createParcelMapPngRequestHandler(components)
  )
  server.get(
    '/v1/estates/:id/map.png',
    createEstateMapPngRequestHandler(components)
  )
}
