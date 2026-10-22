import {
  IBaseComponent,
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'
import future from 'fp-future'
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
const futureExpiration = Math.round(Date.now() / 1000) + 3600

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

function toRecord(tiles: Tile[]): Record<string, Tile> {
  return Object.fromEntries(tiles.map((tile) => [tile.id, tile]))
}

describe('map component', () => {
  let map: IMapComponent & IBaseComponent
  let fetchData: jest.Mock
  let fetchUpdatedData: jest.Mock
  let getTilesJson: jest.Mock
  let getTimestamp: jest.Mock
  let getActiveTrades: jest.Mock
  let freshResult: Result
  let readyEvent: Promise<void>

  beforeEach(async () => {
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
    getActiveTrades = jest.fn().mockResolvedValue([])

    const config = {
      requireNumber: jest.fn().mockResolvedValue(0.001),
      requireString: jest.fn().mockResolvedValue(LAND_CONTRACT_ADDRESS),
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
      getFileUrl: jest.fn().mockResolvedValue('https://cdn.example.com'),
      uploadTilesJson: jest.fn().mockResolvedValue('https://cdn.example.com'),
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
    readyEvent = new Promise((resolve) =>
      map.events.once(MapEvents.READY, () => resolve())
    )
  })

  afterEach(async () => {
    await map.stop!()
  })

  describe('when starting the component', () => {
    describe('and the first load has not finished', () => {
      beforeEach(async () => {
        fetchData.mockReturnValueOnce(future<Result>())
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
        await map.start!({} as any)
        await readyEvent
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

    describe('and the S3 cache has tiles with outdated special types', () => {
      beforeEach(async () => {
        getTilesJson.mockResolvedValueOnce(
          toRecord([
            buildTile('1,1', { type: TileType.DISTRICT }),
            buildTile('0,0', { type: TileType.PLAZA }),
          ])
        )
        getTimestamp.mockResolvedValueOnce(3000)
        fetchData.mockResolvedValueOnce(freshResult)
        await map.start!({} as any)
        await readyEvent
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

    describe('and the S3 cache matches the special tiles', () => {
      let cachedTiles: Tile[]

      beforeEach(async () => {
        cachedTiles = [
          buildTile('1,1', { name: 'Cached' }),
          buildTile('0,0', { type: TileType.PLAZA }),
        ]
        getTilesJson.mockResolvedValueOnce(toRecord(cachedTiles))
        getTimestamp.mockResolvedValueOnce(3000)
        fetchData.mockResolvedValueOnce(freshResult)
        await map.start!({} as any)
        await readyEvent
      })

      it('should serve the cached tiles', async () => {
        await expect(map.getTiles()).resolves.toEqual(toRecord(cachedTiles))
      })

      it('should use the cached timestamp', () => {
        expect(map.getLastUpdatedAt()).toBe(3000)
      })
    })

    describe('and a cached tile has a price from a trade', () => {
      beforeEach(() => {
        getTilesJson.mockResolvedValueOnce(
          toRecord([buildTile('1,1', { price: 10 })])
        )
        getTimestamp.mockResolvedValueOnce(3000)
        fetchData.mockResolvedValueOnce(freshResult)
      })

      describe('and the trade is no longer active', () => {
        beforeEach(async () => {
          await map.start!({} as any)
          await readyEvent
        })

        it('should clear the price', async () => {
          expect((await map.getTiles())['1,1'].price).toBeUndefined()
        })
      })

      describe('and fetching the active trades fails', () => {
        beforeEach(async () => {
          getActiveTrades.mockRejectedValueOnce(new Error('Database error'))
          await map.start!({} as any)
          await readyEvent
        })

        it('should keep the price', async () => {
          expect((await map.getTiles())['1,1'].price).toBe(10)
        })
      })
    })

    describe('and a cached tile has a price from an order', () => {
      beforeEach(async () => {
        getTilesJson.mockResolvedValueOnce(
          toRecord([
            buildTile('1,1', { price: 20, expiresAt: futureExpiration }),
          ])
        )
        getTimestamp.mockResolvedValueOnce(3000)
        fetchData.mockResolvedValueOnce(freshResult)
        await map.start!({} as any)
        await readyEvent
      })

      it('should keep the price', async () => {
        expect((await map.getTiles())['1,1'].price).toBe(20)
      })
    })

    describe('and an active trade sells a parcel', () => {
      let trade: Trade

      beforeEach(async () => {
        trade = {
          id: 'trade-1',
          created_at: new Date(2000).toISOString(),
          type: 'public_nft_order',
          signer: '0xsigner',
          contract_address_sent: LAND_CONTRACT_ADDRESS,
          amount_received: '3000000000000000000',
          available: true,
          sent_token_id: '11',
          status: 'open',
        }
        getActiveTrades.mockResolvedValueOnce([trade])
        fetchData.mockResolvedValueOnce(freshResult)
        await map.start!({} as any)
        await readyEvent
      })

      it('should set the trade price on the parcel tile', async () => {
        expect((await map.getTiles())['1,1'].price).toBe(3)
      })
    })
  })
})
