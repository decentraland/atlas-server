import { AppComponents, GlobalContext } from '../types'
import { lastModifiedMiddleware } from '../logic/last-modified-middleware'
import {
  estateMapPngRequestHandler,
  estateRequestHandler,
  createLegacyTilesRequestHandler,
  mapPngRequestHandler,
  parcelMapPngRequestHandler,
  parcelRequestHandler,
  readyRequestHandler,
  createTilesRequestHandler,
  tokenRequestHandler,
  pingRequestHandler,
  tilesInfoRequestHandler,
  miniMapHandler,
  estateMapHandler,
} from './handlers'

import { Router } from '@well-known-components/http-server'

export type RoutesComponents = Pick<
  AppComponents,
  'server' | 'map' | 'image' | 'config' | 'api' | 'district'
>

// We return the entire router because it will be easier to test than a whole server
export async function setupRouter(
  components: RoutesComponents
): Promise<Router<GlobalContext>> {
  const router = new Router<GlobalContext>()

  const { district, map } = components
  const getLastModifiedTime = () => map.getLastUpdatedAt() * 1000
  const lastModifiedMiddlewareByMapDate =
    lastModifiedMiddleware(getLastModifiedTime)

  router.get(
    '/v1/tiles',
    lastModifiedMiddlewareByMapDate,
    createLegacyTilesRequestHandler(components)
  )
  router.get(
    '/v2/tiles',
    lastModifiedMiddlewareByMapDate,
    createTilesRequestHandler(components)
  )
  router.get('/v2/tiles/info', tilesInfoRequestHandler)
  router.get(
    '/v1/map.png',
    lastModifiedMiddlewareByMapDate,
    mapPngRequestHandler
  )
  router.get(
    '/v1/minimap.png',
    lastModifiedMiddleware(getLastModifiedTime, {
      maxAge: 600,
      staleWhileRevalidate: 600,
    }),
    miniMapHandler
  )
  router.get(
    '/v1/estatemap.png',
    lastModifiedMiddleware(getLastModifiedTime, {
      maxAge: 600,
      staleWhileRevalidate: 600,
    }),
    estateMapHandler
  )
  router.get(
    '/v1/parcels/:x/:y/map.png',
    lastModifiedMiddlewareByMapDate,
    parcelMapPngRequestHandler
  )
  router.get(
    '/v1/estates/:estateId/map.png',
    lastModifiedMiddlewareByMapDate,
    estateMapPngRequestHandler
  )
  router.get(
    '/v2/map.png',
    lastModifiedMiddlewareByMapDate,
    mapPngRequestHandler
  )
  router.get(
    '/v2/parcels/:x/:y/map.png',
    lastModifiedMiddlewareByMapDate,
    parcelMapPngRequestHandler
  )
  router.get(
    '/v2/estates/:estateId/map.png',
    lastModifiedMiddlewareByMapDate,
    estateMapPngRequestHandler
  )
  router.get('/v2/ping', pingRequestHandler)
  router.get('/v2/ready', readyRequestHandler)
  router.get(
    '/v2/parcels/:x/:y',
    lastModifiedMiddlewareByMapDate,
    parcelRequestHandler
  )
  router.get(
    '/v2/estates/:id',
    lastModifiedMiddlewareByMapDate,
    estateRequestHandler
  )
  router.get(
    '/v2/contracts/:address/tokens/:id',
    lastModifiedMiddlewareByMapDate,
    tokenRequestHandler
  )
  router.get('/v2/districts', lastModifiedMiddlewareByMapDate, async () => ({
    status: 200,
    body: { ok: true, data: district.getDistricts() },
  }))
  router.get(
    '/v2/districts/:id',
    lastModifiedMiddlewareByMapDate,
    async (req) => {
      const result = district.getDistrict(req.params.id)
      if (result) {
        return {
          status: 200,
          body: { ok: true, data: result },
        }
      } else {
        return {
          status: 404,
          body: 'Not found',
        }
      }
    }
  )

  router.get(
    '/v2/addresses/:address/contributions',
    lastModifiedMiddlewareByMapDate,
    async (req) => ({
      status: 200,
      body: {
        ok: true,
        data: district.getContributionsByAddress(req.params.address),
      },
    })
  )

  return router
}
