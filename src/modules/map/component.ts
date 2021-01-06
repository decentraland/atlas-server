import { EventEmitter } from 'events'
import future from 'fp-future'
import {
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'
import { IApiComponent } from '../api/types'
import { IMapComponent, MapEvents, Tile } from './types'
import { addSpecialTiles, addTiles } from './utils'

export async function createMapComponent(components: {
  config: IConfigComponent
  api: IApiComponent
  logs: ILoggerComponent
}): Promise<IMapComponent> {
  const { config, api, logs } = components
  const logger = logs.getLogger('map-component')

  // config
  const refreshInterval =
    (await config.requireNumber('REFRESH_INTERVAL')) * 1000

  // events
  const events = new EventEmitter()

  // data
  let tiles = future<Record<string, Tile>>()
  let inited = false
  let lastUpdatedAt = 0

  /**
   * Start the component lifecycle. See IBaseComponent
   */
  async function start() {
    if (!inited) {
      try {
        logger.debug(`Fetching data...`)

        const results = await api.fetchTiles()

        const addTilesResult = addTiles(results, {}, lastUpdatedAt)
        lastUpdatedAt = addTilesResult.lastUpdatedAt

        tiles.resolve(addSpecialTiles(addTilesResult.tiles))
        setTimeout(poll, refreshInterval)
        events.emit(MapEvents.READY, results)

        logger.debug(`Total: ${results.length.toLocaleString()} parcels`)
        logger.debug(`Polling changes every ${refreshInterval}ms`)

        inited = true
      } catch (error) {
        logger.error(error)
        inited = false
        tiles.reject(error)
        throw error
      }
    }
  }

  /**
   * Readiness probes indicate whether your application is ready to
   * handle requests. It could be that your application is alive, but
   * that it just can't handle HTTP traffic. In that case, Kubernetes
   * won't kill the container, but it will stop sending it requests.
   * In practical terms, that means the pod is removed from an
   * associated service's "pool" of pods that are handling requests,
   * by marking the pod as "Unready".
   *
   * IMPORTANT: This method should return as soon as possible, not wait for completion.
   */
  async function readynessProbe(): Promise<boolean> {
    return inited
  }

  async function poll() {
    const updatedTiles = await api.fetchUpdatedTiles(lastUpdatedAt)
    if (updatedTiles.length > 0) {
      const oldTiles = await tiles
      const addTilesResult = addTiles(updatedTiles, oldTiles, lastUpdatedAt)
      lastUpdatedAt = addTilesResult.lastUpdatedAt
      tiles = future()
      tiles.resolve(addTilesResult.tiles)
      events.emit(MapEvents.UPDATE, updatedTiles)
    }
    setTimeout(poll, refreshInterval)
  }

  function getTiles() {
    return tiles
  }

  function getLastUpdatedAt() {
    return lastUpdatedAt
  }

  return {
    // IBaseComponent
    start,

    // IStatusCheckCapableComponent
    readynessProbe,

    // map component
    events,
    getTiles,
    getLastUpdatedAt,
  }
}
