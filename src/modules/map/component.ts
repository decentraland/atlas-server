import { EventEmitter } from 'events'
import future from 'fp-future'
import { IApiComponent } from '../api/types'
import { IConfigComponent } from '../config/types'
import { IMapComponent, Tile, MapEvents, MapConfig } from './types'
import { addSpecialTiles, computeEstates } from './utils'

export function createMapComponent(components: {
  config: IConfigComponent<MapConfig>
  api: IApiComponent
}): IMapComponent {
  const { config, api } = components

  // config
  const refreshInterval = config.getNumber('REFRESH_INTERVAL') * 1000

  // events
  const events = new EventEmitter()

  // data
  let tiles = future<Record<string, Tile>>()
  let inited = false
  let lastUpdatedAt = 0

  // methods
  function addTiles(newTiles: Tile[], tiles: Record<string, Tile> = {}) {
    // mutations ahead (for performance reasons)
    for (const tile of newTiles) {
      tiles[tile.id] = tile
      lastUpdatedAt = Math.max(lastUpdatedAt, tile.updatedAt)
    }
    computeEstates(tiles)
    addSpecialTiles(tiles)
    return tiles
  }

  function init() {
    if (!inited) {
      api
        .fetchTiles()
        .then((results) => {
          tiles.resolve(addTiles(results))
          setTimeout(poll, refreshInterval)
          events.emit(MapEvents.READY, results)
        })
        .catch((error) => {
          inited = false
          tiles.reject(error)
          events.emit(MapEvents.ERROR, error)
        })
      inited = true
      events.emit(MapEvents.INIT)
    }
  }

  async function poll() {
    console.log('lastUpdatedAt', lastUpdatedAt)
    const updatedTiles = await api.fetchUpdatedTiles(lastUpdatedAt)
    if (updatedTiles.length > 0) {
      tiles = future()
      tiles.resolve(addTiles(updatedTiles, await tiles))
      events.emit(MapEvents.UPDATE, updatedTiles)
    }
    setTimeout(poll, refreshInterval)
  }

  function getTiles() {
    init()
    return tiles
  }

  return {
    events,
    init,
    getTiles,
  }
}
