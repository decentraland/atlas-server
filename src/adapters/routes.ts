import { AppComponents } from '../types'
import {
  createEstateMapPngRequestHandler,
  createEstateRequestHandler,
  createLegacyTilesRequestHandler,
  createMapPngRequestHandler,
  createParcelMapPngRequestHandler,
  createParcelRequestHandler,
  createPingRequestHandler,
  createReadyRequestHandler,
  createTilesRequestHandler,
  createTokenRequestHandler,
} from './handlers'

import { register, Counter } from 'prom-client'

const districtByIdCounter = new Counter({
  name: 'dcl_districts_by_id_counter',
  help: 'How many times the districtbyid was called',
})

export function setupRoutes(
  components: Pick<
    AppComponents,
    'server' | 'map' | 'image' | 'config' | 'api' | 'district'
  >
) {
  const { server, district } = components
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
  server.get('/v2/ready', createReadyRequestHandler(components))
  server.get('/v2/parcels/:x/:y', createParcelRequestHandler(components))
  server.get('/v2/estates/:id', createEstateRequestHandler(components))
  server.get(
    '/v2/contracts/:address/tokens/:id',
    createTokenRequestHandler(components)
  )
  server.get(
    '/v2/districts',
    server.handle(async () => ({ status: 200, body: district.getDistricts() }))
  )
  server.get(
    '/v2/districts/:id',
    server.handle(async (req) => {
      districtByIdCounter.inc()

      return {
        status: 200,
        body: district.getDistrict(req.params.id),
      }
    })
  )
  server.get(
    '/v2/addresses/:address/contributions',
    server.handle(async (req) => ({
      status: 200,
      body: district.getContributionsByAddress(req.params.address),
    }))
  )
  server.get('/metrics', async (req, res) => {
    res.header('content-type', register.contentType)
    res.send(await register.metrics())
  })
}
