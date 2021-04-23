import { AppComponents, GlobalContext } from '../types'
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
  tilesInfoRequestHandler
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

  const { district } = components
  router.get('/v1/tiles', createLegacyTilesRequestHandler(components))
  router.get('/v2/tiles', createTilesRequestHandler(components))
  router.get('/v2/tiles/info', tilesInfoRequestHandler)
  router.get('/v1/map.png', mapPngRequestHandler)
  router.get('/v1/parcels/:x/:y/map.png', parcelMapPngRequestHandler)
  router.get('/v1/estates/:estateId/map.png', estateMapPngRequestHandler)
  router.get('/v2/map.png', mapPngRequestHandler)
  router.get('/v2/parcels/:x/:y/map.png', parcelMapPngRequestHandler)
  router.get('/v2/estates/:estateId/map.png', estateMapPngRequestHandler)
  router.get('/v2/ping', pingRequestHandler)
  router.get('/v2/ready', readyRequestHandler)
  router.get('/v2/parcels/:x/:y', parcelRequestHandler)
  router.get('/v2/estates/:id', estateRequestHandler)
  router.get('/v2/contracts/:address/tokens/:id', tokenRequestHandler)
  router.get('/v2/districts', async () => ({
    status: 200,
    body: { ok: true, data: district.getDistricts() },
  }))
  router.get('/v2/districts/:id', async (req) => {
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
  })

  router.get('/v2/addresses/:address/contributions', async (req) => ({
    status: 200,
    body: { ok: true, data: district.getContributionsByAddress(req.params.address) },
  }))

  return router
}
