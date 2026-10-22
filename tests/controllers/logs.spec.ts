import { EventEmitter } from 'events'
import { setupLogs } from '../../src/controllers/logs'
import { Result } from '../../src/modules/api/types'
import { MapEvents, Tile, TileType } from '../../src/modules/map/types'
import { AppComponents } from '../../src/types'

describe('when the map emits an update', () => {
  let mapEvents: EventEmitter
  let debug: jest.Mock
  let consoleLog: jest.SpyInstance
  let result: Result

  beforeEach(() => {
    mapEvents = new EventEmitter()
    debug = jest.fn()
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => undefined)
    const tile: Tile = {
      id: '12,-34',
      x: 12,
      y: -34,
      type: TileType.OWNED,
      top: false,
      left: false,
      topLeft: false,
      updatedAt: 1,
    }
    result = {
      tiles: [tile, tile],
      parcels: [],
      estates: [],
      updatedAt: 1,
      cursors: { land: 1, rentals: 1 },
    }
    setupLogs({
      config: {} as AppComponents['config'],
      map: { events: mapEvents } as unknown as AppComponents['map'],
      batchApi: {
        events: new EventEmitter(),
      } as unknown as AppComponents['batchApi'],
      logs: {
        getLogger: () => ({
          debug,
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          log: jest.fn(),
        }),
      },
    })
    mapEvents.emit(MapEvents.UPDATE, result)
  })

  afterEach(() => {
    consoleLog.mockRestore()
  })

  it('should log the number of updated tiles at debug level', () => {
    expect(debug).toHaveBeenCalledWith('Updating tiles', { count: 2 })
  })

  it('should not print the coordinates of the updated tiles', () => {
    expect(consoleLog).not.toHaveBeenCalledWith(
      expect.stringContaining('12,-34')
    )
  })
})
