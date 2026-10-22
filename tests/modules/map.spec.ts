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
      cursors: { land: 5, rentals: 5000 },
    }
    fetchData = jest.fn()
    fetchUpdatedData = jest.fn().mockResolvedValue({
      tiles: [],
      parcels: [],
      estates: [],
      updatedAt: 5000,
      cursors: { land: 5, rentals: 5000 },
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

    describe('and S3 has tiles uploaded by a previous run', () => {
      beforeEach(async () => {
        getTilesJson.mockResolvedValue(
          toRecord([buildTile('1,1', { name: 'Cached', owner: '0xstale' })])
        )
        getTimestamp.mockResolvedValue({ timestamp: 3000, version: 2 })
        fetchData.mockResolvedValueOnce(freshResult)
        await startAndWaitUntilReady()
      })

      it('should not read them', () => {
        expect(
          getTilesJson.mock.calls.length + getTimestamp.mock.calls.length
        ).toBe(0)
      })

      it('should serve the freshly fetched tiles', async () => {
        await expect(map.getTiles()).resolves.toEqual(
          toRecord(freshResult.tiles)
        )
      })

      it('should use the timestamp of the fresh data', () => {
        expect(map.getLastUpdatedAt()).toBe(5000)
      })

      it('should poll from the cursors of the fresh data', async () => {
        await waitUntil(() => fetchUpdatedData.mock.calls.length >= 1)
        expect(fetchUpdatedData.mock.calls[0][0]).toEqual(freshResult.cursors)
      })
    })

    describe('and a tile has an order newer than an active trade', () => {
      beforeEach(async () => {
        freshResult.tiles = [
          buildTile('1,1', {
            price: 20,
            expiresAt: futureExpiration,
            orderCreatedAt: 3000,
            updatedAt: 9000,
          }),
        ]
        fetchData.mockResolvedValueOnce(freshResult)
        getActiveTrades.mockResolvedValueOnce([buildTrade()])
        await startAndWaitUntilReady()
      })

      it('should show the order price', async () => {
        expect((await map.getTiles())['1,1'].price).toBe(20)
      })
    })

    describe('and a tile updated after its order was created has an older order than an active trade', () => {
      beforeEach(async () => {
        freshResult.tiles = [
          buildTile('1,1', {
            price: 20,
            expiresAt: futureExpiration,
            orderCreatedAt: 1000,
            updatedAt: 9000,
          }),
        ]
        fetchData.mockResolvedValueOnce(freshResult)
        getActiveTrades.mockResolvedValueOnce([buildTrade()])
        await startAndWaitUntilReady()
      })

      it('should show the trade price', async () => {
        expect((await map.getTiles())['1,1'].price).toBe(3)
      })
    })

    describe('and a tile has an order', () => {
      beforeEach(async () => {
        freshResult.tiles = [
          buildTile('1,1', {
            price: 20,
            expiresAt: futureExpiration,
            orderCreatedAt: 1000,
          }),
        ]
        fetchData.mockResolvedValueOnce(freshResult)
        await startAndWaitUntilReady()
      })

      it('should not serve the order creation time', async () => {
        expect((await map.getTiles())['1,1']).not.toHaveProperty(
          'orderCreatedAt'
        )
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

    describe('and an update brings a tile whose rental listing has expired', () => {
      beforeEach(async () => {
        fetchData.mockResolvedValueOnce(freshResult)
        fetchUpdatedData.mockResolvedValueOnce({
          tiles: [
            buildTile('1,1', {
              rentalListing: {
                expiration: Date.now() - 1000,
                periods: [],
                updatedAt: 6000,
              },
            }),
          ],
          parcels: [],
          estates: [],
          updatedAt: 6000,
          cursors: { land: 5, rentals: 6000 },
        })
        await startAndWaitUntilReady()
        await waitUntil(() => fetchUpdatedData.mock.calls.length >= 2)
      })

      it('should remove the rental listing from the tile', async () => {
        expect((await map.getTiles())['1,1'].rentalListing).toBeUndefined()
      })
    })

    describe('and an update returns new cursors', () => {
      beforeEach(async () => {
        fetchData.mockResolvedValueOnce(freshResult)
        fetchUpdatedData.mockResolvedValueOnce({
          tiles: [],
          parcels: [],
          estates: [],
          updatedAt: 5000,
          cursors: { land: 9, rentals: 9000 },
        })
        await startAndWaitUntilReady()
        await waitUntil(() => fetchUpdatedData.mock.calls.length >= 2)
      })

      it('should resume the next update from them', () => {
        expect(fetchUpdatedData.mock.calls[1][0]).toEqual({
          land: 9,
          rentals: 9000,
        })
      })
    })

    describe('and fetching the land updates fails', () => {
      beforeEach(async () => {
        fetchData.mockResolvedValueOnce(freshResult)
        fetchUpdatedData.mockRejectedValueOnce(new Error('Subgraph 502'))
        await startAndWaitUntilReady()
        await waitUntil(() => fetchUpdatedData.mock.calls.length >= 2)
      })

      it('should retry from the previous cursors', () => {
        expect(fetchUpdatedData.mock.calls[1][0]).toEqual(freshResult.cursors)
      })

      it('should keep serving the previous tiles', async () => {
        await expect(map.getTiles()).resolves.toEqual(
          toRecord(freshResult.tiles)
        )
      })
    })

    describe('and a parcel leaves an estate', () => {
      beforeEach(async () => {
        freshResult.tiles = [
          buildTile('1,1', { estateId: '7' }),
          buildTile('2,1', { estateId: '7' }),
          buildTile('1,2', { estateId: '7' }),
          buildTile('1,0', { estateId: '7' }),
          buildTile('2,0', { estateId: '7' }),
        ]
        fetchData.mockResolvedValueOnce(freshResult)
        fetchUpdatedData.mockResolvedValueOnce({
          tiles: [buildTile('1,1')],
          parcels: [],
          estates: [],
          updatedAt: 6000,
          cursors: { land: 6, rentals: 5000 },
        })
        await startAndWaitUntilReady()
        await waitUntil(() => fetchUpdatedData.mock.calls.length >= 2)
      })

      it('should unstitch the neighbours that depended on it', async () => {
        const tiles = await map.getTiles()
        expect({
          rightLeft: tiles['2,1'].left,
          bottomTop: tiles['1,0'].top,
          bottomRightTopLeft: tiles['2,0'].topLeft,
        }).toEqual({
          rightLeft: false,
          bottomTop: false,
          bottomRightTopLeft: false,
        })
      })
    })

    describe('and the trades are being fetched after an update', () => {
      beforeEach(async () => {
        freshResult.tiles = [buildTile('1,1', { owner: '0xold' })]
        fetchData.mockResolvedValueOnce(freshResult)
        fetchUpdatedData.mockResolvedValueOnce({
          tiles: [buildTile('1,1', { owner: '0xnew' })],
          parcels: [],
          estates: [],
          updatedAt: 6000,
          cursors: { land: 6, rentals: 5000 },
        })
        getActiveTrades
          .mockResolvedValueOnce([])
          .mockReturnValueOnce(future<Trade[]>())
        await startAndWaitUntilReady()
        await waitUntil(() => getActiveTrades.mock.calls.length >= 2)
      })

      it('should keep serving the previous tiles unchanged', async () => {
        expect((await map.getTiles())['1,1'].owner).toBe('0xold')
      })
    })

    describe('and fetching the land updates keeps failing', () => {
      beforeEach(() => {
        fetchUpdatedData.mockRejectedValue(new Error('Subgraph 502'))
      })

      describe('and a trade opens', () => {
        beforeEach(async () => {
          fetchData.mockResolvedValueOnce(freshResult)
          getActiveTrades
            .mockResolvedValueOnce([])
            .mockResolvedValue([buildTrade()])
          await startAndWaitUntilReady()
          await waitUntil(() => getActiveTrades.mock.calls.length >= 3)
        })

        it('should still show the trade price', async () => {
          expect((await map.getTiles())['1,1'].price).toBe(3)
        })
      })

      describe('and a rental listing expires', () => {
        let expiration: number

        beforeEach(async () => {
          expiration = Date.now() + 100
          freshResult.tiles = [
            buildTile('1,1', {
              rentalListing: { expiration, periods: [], updatedAt: 1000 },
            }),
          ]
          fetchData.mockResolvedValueOnce(freshResult)
          await startAndWaitUntilReady()
          await waitUntil(() => Date.now() > expiration + 50)
        })

        it('should still remove the rental listing', async () => {
          expect((await map.getTiles())['1,1'].rentalListing).toBeUndefined()
        })
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
