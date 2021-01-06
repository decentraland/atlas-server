import { createDappsWrapper } from '../logic/dapps-wrapper'
import { GlobalContext } from '../types'
import {
  createLegacyTilesRequestHandler,
  createTilesRequestHandler,
  estateMapPngRequestHandler,
  mapPngRequestHandler,
  parcelMapPngRequestHandler,
  pingRequestHandler,
} from './handlers'

export function setupRoutes(globalContext: GlobalContext) {
  const { components } = globalContext
  const { server } = components

  const dappsMiddleware = createDappsWrapper<GlobalContext>(components)
  const t = dappsMiddleware(createLegacyTilesRequestHandler(components))
  server.get(globalContext, '/v1/tiles', t)
  server.get(
    globalContext,
    '/v2/tiles',
    dappsMiddleware(createTilesRequestHandler(components))
  )
  server.get(
    globalContext,
    '/v1/map.png',
    dappsMiddleware(mapPngRequestHandler)
  )
  server.get(
    globalContext,
    '/v1/parcels/:x/:y/map.png',
    dappsMiddleware(parcelMapPngRequestHandler)
  )
  server.get(
    globalContext,
    '/v1/estates/:id/map.png',
    dappsMiddleware(estateMapPngRequestHandler)
  )
  server.get(globalContext, '/v2/ping', dappsMiddleware(pingRequestHandler))
}
