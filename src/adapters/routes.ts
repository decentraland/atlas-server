import { AppComponents } from '../types'
import {
  createEstateMapPngRequestHandler,
  createEstateRequestHandler,
  createLegacyTilesRequestHandler,
  createMapPngRequestHandler,
  createParcelMapPngRequestHandler,
  createParcelRequestHandler,
  createPingRequestHandler,
  createTilesRequestHandler,
  createTokenRequestHandler,
} from './handlers'

export function setupRoutes(
  components: Pick<
    AppComponents,
    'server' | 'map' | 'image' | 'config' | 'redirect' | 'api'
  >
) {
  const { server, redirect } = components
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
  server.get('/v2/ping', createPingRequestHandler(components))
  server.get('/v2/parcels/:x/:y', createParcelRequestHandler(components))
  server.get('/v2/estates/:id', createEstateRequestHandler(components))
  server.get(
    '/v2/contracts/:address/tokens/:id',
    createTokenRequestHandler(components)
  )

  // forward legacy endpoints
  server.get('/v1/**', redirect)
}
