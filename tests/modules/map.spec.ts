import {
  IBaseComponent,
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'
import future, { IFuture } from 'fp-future'
import { IApiComponent, Result } from '../../src/modules/api/types'
import { createMapComponent } from '../../src/modules/map/component'
import {
  IMapComponent,
  MapEvents,
  Tile,
  TileType,
} from '../../src/modules/map/types'
import { IS3Component } from '../../src/modules/s3/component'
import { ITradesComponent, Trade } from '../../src/modules/trades/component'
import { AppComponents } from '../../src/types'

jest.mock('../../src/modules/map/data/specialTiles.json', () => ({
  '0,0': {
    id: '0,0',
    type: 'plaza',
    top: false,
    left: false,
    topLeft: false,
    name: 'Genesis Plaza',
  },
}))

const LAND_CONTRACT_ADDRESS = '0xland'
const ESTATE_CONTRACT_ADDRESS = '0xestate'
const CACHE_VERSION = 2
const futureExpiration = Math.round(Date.now() / 1000) + 3600
const pastExpiration = Math.round(Date.now() / 1000) - 3600

function buildTile(id: string, overrides: Partial<Tile> = {}): Tile {
  const [x, y] = id.split(',').map(Number)
  return {
    id,
    x,
    y,
    type: TileType.OWNED,
    top: false,
    left: false,
    topLeft: false,
    updatedAt: 1000,
    nftId: `parcel-${LAND_CONTRACT_ADDRESS}-${x}${y}`,
    tokenId: `${x}${y}`,
    ...overrides,
  }
}

function buildTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 'trade-1',
    created_at: new Date(2000).toISOString(),
    type: 'public_nft_order',
    signer: '0xsigner',
    contract_address_sent: LAND_CONTRACT_ADDRESS,
    amount_received: '3000000000000000000',
    available: true,
    sent_token_id: '11',
    status: 'open',
    ...overrides,
  }
}

function toRecord(tiles: Tile[]): Record<string, Tile> {
  return Object.fromEntries(tiles.map((tile) => [tile.id, tile]))
}

async function waitUntil(condition: () => boolean) {
  for (let i = 0; i < 500 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

describe('map component', () => {
  let map: IMapComponent & IBaseComponent
  let refreshIntervalInSeconds: number
  let fetchData: jest.Mock
  let fetchUpdatedData: jest.Mock
  let getTilesJson: jest.Mock
  let getTimestamp: jest.Mock
  let uploadTilesJson: jest.Mock
  let getActiveTrades: jest.Mock
  let freshResult: Result
  let readyEvent: Promise<void>

  beforeEach(async () => {
    refreshIntervalInSeconds = 0.001
    freshResult = {
      tiles: [buildTile('1,1'), buildTile('0,0', { type: TileType.PLAZA })],
      parcels: [],
      estates: [],
      updatedAt: 5000,
    }
    fetchData = jest.fn()
    fetchUpdatedData = jest.fn().mockResolvedValue({
      tiles: [],
      parcels: [],
      estates: [],
      updatedAt: 5000,
    })
    getTilesJson = jest.fn().mockResolvedValue(null)
    getTimestamp = jest.fn().mockResolvedValue(null)
    uploadTilesJson = jest.fn().mockResolvedValue('https://cdn.example.com')
    getActiveTrades = jest.fn().mockResolvedValue([])
  })

  async function createMap() {
    const config = {
      requireNumber: jest.fn().mockResolvedValue(refreshIntervalInSeconds),
      requireString: jest.fn((name: string) =>
        Promise.resolve(
          name === 'ESTATE_CONTRACT_ADDRESS'
            ? ESTATE_CONTRACT_ADDRESS
            : LAND_CONTRACT_ADDRESS
        )
      ),
    } as unknown as IConfigComponent
    const logs: ILoggerComponent = {
      getLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        log: jest.fn(),
      }),
    }
    const s3 = {
      getTilesJson,
      getTimestamp,
      uploadTilesJson,
      getFileUrl: jest.fn().mockResolvedValue('https://cdn.example.com'),
      uploadTimestamp: jest.fn().mockResolvedValue(undefined),
    } as unknown as IS3Component
    const trades = { getActiveTrades } as unknown as ITradesComponent
    const tracer = {
      span: (_name: string, fn: () => unknown) => fn(),
    } as unknown as AppComponents['tracer']

    map = await createMapComponent({
      config,
      logs,
      s3,
      trades,
      tracer,
      api: { fetchUpdatedData } as unknown as IApiComponent,
      batchApi: { fetchData } as unknown as IApiComponent,
    })
    map.events.on(MapEvents.ERROR, () => undefined)
    readyEvent = new Promise((resolve) =>
      map.events.once(MapEvents.READY, () => resolve())
    )
  }

  async function startAndWaitUntilReady() {
    await createMap()
    await map.start!({} as any)
    await readyEvent
  }

  afterEach(async () => {
    await map.stop!()
    jest.useRealTimers()
  })

  describe('when starting the component', () => {
    describe('and the first load has not finished', () => {
      beforeEach(async () => {
        fetchData.mockReturnValueOnce(future<Result>())
        await createMap()
        await map.start!({} as any)
      })

      it('should return without waiting for the data', () => {
        expect(map.isReady()).toBe(false)
      })
    })

    describe('and the first load fails', () => {
      beforeEach(async () => {
        fetchData
          .mockRejectedValueOnce(new Error('Subgraph unavailable'))
          .mockResolvedValueOnce(freshResult)
        await startAndWaitUntilReady()
      })

      it('should retry the load until it succeeds', () => {
        expect(fetchData).toHaveBeenCalledTimes(2)
      })

      it('should become ready', () => {
        expect(map.isReady()).toBe(true)
      })

      it('should serve the loaded tiles', async () => {
        await expect(map.getTiles()).resolves.toEqual(
          toRecord(freshResult.tiles)
        )
      })
    })

    describe('and the S3 cache was written by an older version', () => {
      beforeEach(async () => {
        getTilesJson.mockResolvedValueOnce(
          toRecord([buildTile('1,1', { name: 'Cached' })])
        )
        getTimestamp.mockResolvedValueOnce({ timestamp: 3000 })
        fetchData.mockResolvedValueOnce(freshResult)
        await startAndWaitUntilReady()
      })

      it('should serve the freshly fetched tiles', async () => {
        await expect(map.getTiles()).resolves.toEqual(
          toRecord(freshResult.tiles)
        )
      })

      it('should use the timestamp of the fresh data', () => {
        expect(map.getLastUpdatedAt()).toBe(5000)
      })
    })

    describe('and the S3 cache has tiles with outdated special types', () => {
      beforeEach(async () => {
        getTilesJson.mockResolvedValueOnce(
          toRecord([
            buildTile('1,1', { type: TileType.DISTRICT }),
            buildTile('0,0', { type: TileType.PLAZA }),
          ])
        )
        getTimestamp.mockResolvedValueOnce({
          timestamp: 3000,
          version: CACHE_VERSION,
        })
        fetchData.mockResolvedValueOnce(freshResult)
        await startAndWaitUntilReady()
      })

      it('should serve the freshly fetched tiles', async () => {
        await expect(map.getTiles()).resolves.toEqual(
          toRecord(freshResult.tiles)
        )
      })
    })

    describe('and the S3 cache is up to date', () => {
      let cachedTiles: Tile[]

      beforeEach(() => {
        getTimestamp.mockResolvedValueOnce({
          timestamp: 3000,
          version: CACHE_VERSION,
        })
      })

      describe('and its tiles have no prices', () => {
        beforeEach(async () => {
          cachedTiles = [
            buildTile('1,1', { name: 'Cached' }),
            buildTile('0,0', { type: TileType.PLAZA }),
          ]
          getTilesJson.mockResolvedValueOnce(toRecord(cachedTiles))
          fetchData.mockResolvedValueOnce(freshResult)
          await startAndWaitUntilReady()
        })

        it('should serve the cached tiles', async () => {
          await expect(map.getTiles()).resolves.toEqual(toRecord(cachedTiles))
        })

        it('should use the cached timestamp', () => {
          expect(map.getLastUpdatedAt()).toBe(3000)
        })
      })

      describe('and a cached tile has a price the fresh data does not have', () => {
        beforeEach(async () => {
          getTilesJson.mockResolvedValueOnce(
            toRecord([
              buildTile('1,1', { price: 10, expiresAt: futureExpiration }),
            ])
          )
          fetchData.mockResolvedValueOnce(freshResult)
          await startAndWaitUntilReady()
        })

        it('should drop the cached price', async () => {
          expect((await map.getTiles())['1,1'].price).toBeUndefined()
        })
      })

      describe('and a cached tile was priced by a trade that is still active', () => {
        beforeEach(async () => {
          getTilesJson.mockResolvedValueOnce(
            toRecord([buildTile('1,1', { price: 3, updatedAt: 2000 })])
          )
          freshResult.tiles = [
            buildTile('1,1', {
              price: 20,
              expiresAt: futureExpiration,
              updatedAt: 1000,
            }),
          ]
          fetchData.mockResolvedValueOnce(freshResult)
          getActiveTrades.mockResolvedValueOnce([buildTrade()])
          await startAndWaitUntilReady()
        })

        it('should show the trade price over the older order', async () => {
          expect((await map.getTiles())['1,1'].price).toBe(3)
        })
      })

      describe('and the fresh data has an order price for a cached tile', () => {
        beforeEach(async () => {
          getTilesJson.mockResolvedValueOnce(toRecord([buildTile('1,1')]))
          freshResult.tiles = [
            buildTile('1,1', { price: 20, expiresAt: futureExpiration }),
          ]
          fetchData.mockResolvedValueOnce(freshResult)
          await startAndWaitUntilReady()
        })

        it('should use the fresh order price', async () => {
          const tile = (await map.getTiles())['1,1']
          expect({ price: tile.price, expiresAt: tile.expiresAt }).toEqual({
            price: 20,
            expiresAt: futureExpiration,
          })
        })
      })
    })

    describe('and an active trade sells a parcel', () => {
      beforeEach(async () => {
        getActiveTrades.mockResolvedValueOnce([buildTrade()])
        fetchData.mockResolvedValueOnce(freshResult)
        await startAndWaitUntilReady()
      })

      it('should set the trade price on the parcel tile', async () => {
        expect((await map.getTiles())['1,1'].price).toBe(3)
      })
    })

    describe('and two active trades sell the same parcel', () => {
      beforeEach(async () => {
        getActiveTrades.mockResolvedValueOnce([
          buildTrade({
            id: 'trade-2',
            created_at: new Date(4000).toISOString(),
            amount_received: '5000000000000000000',
          }),
          buildTrade(),
        ])
        fetchData.mockResolvedValueOnce(freshResult)
        await startAndWaitUntilReady()
      })

      it('should show the price of the newest trade', async () => {
        expect((await map.getTiles())['1,1'].price).toBe(5)
      })
    })

    describe('and an active trade sells a token from another contract with the same id as a parcel', () => {
      beforeEach(async () => {
        getActiveTrades.mockResolvedValueOnce([
          buildTrade({ contract_address_sent: '0xother' }),
        ])
        fetchData.mockResolvedValueOnce(freshResult)
        await startAndWaitUntilReady()
      })

      it('should not price the parcel tile', async () => {
        expect((await map.getTiles())['1,1'].price).toBeUndefined()
      })
    })

    describe('and an active trade sells a token whose id matches an estate', () => {
      beforeEach(() => {
        freshResult.tiles = [buildTile('1,1', { estateId: '7' })]
        fetchData.mockResolvedValueOnce(freshResult)
      })

      describe('and the token is not from the estate contract', () => {
        beforeEach(async () => {
          getActiveTrades.mockResolvedValueOnce([
            buildTrade({ sent_token_id: '7' }),
          ])
          await startAndWaitUntilReady()
        })

        it('should not price the estate tile', async () => {
          expect((await map.getTiles())['1,1'].price).toBeUndefined()
        })
      })

      describe('and the token is from the estate contract', () => {
        beforeEach(async () => {
          getActiveTrades.mockResolvedValueOnce([
            buildTrade({
              sent_token_id: '7',
              contract_address_sent: ESTATE_CONTRACT_ADDRESS,
            }),
          ])
          await startAndWaitUntilReady()
        })

        it('should price the estate tile', async () => {
          expect((await map.getTiles())['1,1'].price).toBe(3)
        })
      })
    })
  })

  describe('when stopping the component', () => {
    describe('and the first load is still running', () => {
      let pendingFetch: IFuture<Result>

      beforeEach(async () => {
        pendingFetch = future<Result>()
        fetchData.mockReturnValueOnce(pendingFetch)
        await createMap()
        await map.start!({} as any)
        await map.stop!()
        pendingFetch.resolve(freshResult)
        await waitUntil(() => map.isReady())
      })

      it('should not upload the tiles to S3', () => {
        expect(uploadTilesJson).not.toHaveBeenCalled()
      })
    })

    describe('and it is waiting to retry the first load', () => {
      let timersBeforeStop: number

      beforeEach(async () => {
        refreshIntervalInSeconds = 3600
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
        fetchData.mockRejectedValueOnce(new Error('Subgraph unavailable'))
        await createMap()
        await map.start!({} as any)
        for (let i = 0; i < 10 && jest.getTimerCount() === 0; i++) {
          await new Promise((resolve) => setImmediate(resolve))
        }
        timersBeforeStop = jest.getTimerCount()
        await map.stop!()
      })

      it('should cancel the pending retry', () => {
        expect({
          before: timersBeforeStop,
          after: jest.getTimerCount(),
        }).toEqual({ before: 1, after: 0 })
      })
    })
  })

  describe('when polling for updates', () => {
    let uploadsAtReady: number
    let lastUpdatedAtAtReady: number

    describe('and a trade overrides an active order', () => {
      beforeEach(() => {
        freshResult.tiles = [
          buildTile('1,1', { price: 20, expiresAt: futureExpiration }),
        ]
        fetchData.mockResolvedValueOnce(freshResult)
        getActiveTrades.mockResolvedValueOnce([buildTrade()])
      })

      describe('and the trade closes', () => {
        beforeEach(async () => {
          await startAndWaitUntilReady()
          await waitUntil(() => getActiveTrades.mock.calls.length >= 3)
        })

        it('should restore the order price', async () => {
          const tile = (await map.getTiles())['1,1']
          expect({ price: tile.price, expiresAt: tile.expiresAt }).toEqual({
            price: 20,
            expiresAt: futureExpiration,
          })
        })
      })
    })

    describe('and a trade overrides an order that expires before the trade closes', () => {
      beforeEach(async () => {
        freshResult.tiles = [
          buildTile('1,1', { price: 20, expiresAt: pastExpiration }),
        ]
        fetchData.mockResolvedValueOnce(freshResult)
        getActiveTrades.mockResolvedValueOnce([buildTrade()])
        await startAndWaitUntilReady()
        await waitUntil(() => getActiveTrades.mock.calls.length >= 3)
      })

      it('should clear the price', async () => {
        expect((await map.getTiles())['1,1'].price).toBeUndefined()
      })
    })

    describe('and a trade closes without any parcel changing', () => {
      beforeEach(async () => {
        fetchData.mockResolvedValueOnce(freshResult)
        getActiveTrades.mockResolvedValueOnce([buildTrade()])
        await startAndWaitUntilReady()
        uploadsAtReady = uploadTilesJson.mock.calls.length
        lastUpdatedAtAtReady = map.getLastUpdatedAt()
        await waitUntil(() => getActiveTrades.mock.calls.length >= 3)
      })

      it('should clear the trade price', async () => {
        expect((await map.getTiles())['1,1'].price).toBeUndefined()
      })

      it('should upload the tiles to S3 once more', () => {
        expect(uploadTilesJson.mock.calls.length - uploadsAtReady).toBe(2)
      })

      it('should move the last updated time forward', () => {
        expect(map.getLastUpdatedAt()).toBeGreaterThan(lastUpdatedAtAtReady)
      })
    })

    describe('and fetching the active trades fails', () => {
      beforeEach(async () => {
        fetchData.mockResolvedValueOnce(freshResult)
        getActiveTrades
          .mockResolvedValueOnce([buildTrade()])
          .mockRejectedValue(new Error('Database error'))
        await startAndWaitUntilReady()
        await waitUntil(() => getActiveTrades.mock.calls.length >= 3)
      })

      it('should keep the trade price', async () => {
        expect((await map.getTiles())['1,1'].price).toBe(3)
      })
    })
  })
})
