import { EventEmitter } from 'events'
import future from 'fp-future'
import { IApiComponent } from '../api/types'
import { IConfigComponent } from '../config/types'
import { IMapComponent, Tile, MapEvents, MapConfig } from './types'
import { addSpecialTiles, computeEstate } from './utils'

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

  // sort
  const sortByCoords = (a: Tile, b: Tile) =>
    a.x < b.x ? -1 : a.x > b.x ? 1 : a.y > b.y ? -1 : 1 // sort from left to right, from top to bottom

  // methods
  function addTiles(newTiles: Tile[], oldTiles: Record<string, Tile>) {
    // mutations ahead (for performance reasons)
    for (const tile of newTiles.sort(sortByCoords)) {
      oldTiles[tile.id] = tile
      lastUpdatedAt = Math.max(lastUpdatedAt, tile.updatedAt)
      computeEstate(tile.x, tile.y, oldTiles)
    }
    return oldTiles
  }

  function init() {
    if (!inited) {
      api
        .fetchTiles()
        .then((results) => {
          tiles.resolve(addSpecialTiles(addTiles(results, {})))
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
    const updatedTiles = await api.fetchUpdatedTiles(lastUpdatedAt)
    if (updatedTiles.length > 0) {
      const oldTiles = await tiles
      const newTiles = addTiles(updatedTiles, oldTiles)
      tiles = future()
      tiles.resolve(newTiles)
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
