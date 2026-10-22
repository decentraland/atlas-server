import {
  IBaseComponent,
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'
import { IApiComponent, Result } from '../../src/modules/api/types'
import { createMapComponent } from '../../src/modules/map/component'
import {
  IMapComponent,
  MapEvents,
  Tile,
  TileType,
} from '../../src/modules/map/types'
import { IS3Component } from '../../src/modules/s3/component'
import { ITradesComponent } from '../../src/modules/trades/component'
import { AppComponents } from '../../src/types'

jest.mock('../../src/modules/map/data/specialTiles.json', () => ({}))

const CACHE_VERSION = 2
const V1_URL = 'https://cdn.example.com/tiles/v1/latest.json'
const V2_URL = 'https://cdn.example.com/tiles/v2/latest.json'

function buildTile(id: string): Tile {
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
  }
}

async function waitUntil(condition: () => boolean) {
  for (let i = 0; i < 500 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 2))
  }
}

describe('when the map uploads the tiles to S3', () => {
  let map: IMapComponent & IBaseComponent
  let fetchData: jest.Mock
  let fetchUpdatedData: jest.Mock
  let getTilesJson: jest.Mock
  let getTimestamp: jest.Mock
  let uploadTilesJson: jest.Mock
  let freshResult: Result
  let readyEvent: Promise<void>

  beforeEach(() => {
    freshResult = {
      tiles: [buildTile('1,1')],
      parcels: [],
      estates: [],
      updatedAt: 5000,
    }
    fetchData = jest.fn().mockResolvedValue(freshResult)
    fetchUpdatedData = jest.fn().mockResolvedValue({
      tiles: [],
      parcels: [],
      estates: [],
      updatedAt: 5000,
    })
    getTilesJson = jest.fn().mockResolvedValue(null)
    getTimestamp = jest.fn().mockResolvedValue(null)
    uploadTilesJson = jest.fn()
  })

  async function startAndWaitUntilReady(refreshIntervalInSeconds: number) {
    const config = {
      requireNumber: jest.fn().mockResolvedValue(refreshIntervalInSeconds),
      requireString: jest.fn().mockResolvedValue('0xcontract'),
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
      getFileUrl: jest.fn((version: string) =>
        Promise.resolve(version === 'v1' ? V1_URL : V2_URL)
      ),
      uploadTimestamp: jest.fn().mockResolvedValue(undefined),
    } as unknown as IS3Component
    const trades = {
      getActiveTrades: jest.fn().mockResolvedValue([]),
    } as unknown as ITradesComponent
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
    await map.start!({} as any)
    await readyEvent
  }

  afterEach(async () => {
    await map.stop!()
    jest.resetAllMocks()
  })

  describe('and both uploads succeed', () => {
    beforeEach(async () => {
      uploadTilesJson.mockImplementation((version: string) =>
        Promise.resolve(version === 'v1' ? V1_URL : V2_URL)
      )
      await startAndWaitUntilReady(3600)
    })

    it('should expose the uploaded urls for the redirect', () => {
      expect(map.getLastUploadedTilesUrl()).toEqual({ v1: V1_URL, v2: V2_URL })
    })
  })

  describe('and the tiles were loaded from the S3 cache', () => {
    beforeEach(async () => {
      getTilesJson.mockResolvedValueOnce({ '1,1': buildTile('1,1') })
      getTimestamp.mockResolvedValueOnce({
        timestamp: 3000,
        version: CACHE_VERSION,
      })
      uploadTilesJson.mockRejectedValue(new Error('S3 unavailable'))
      await startAndWaitUntilReady(3600)
    })

    describe('and the upload of the served tiles fails', () => {
      it('should not expose the cached files for the redirect', () => {
        expect(map.getLastUploadedTilesUrl()).toEqual({})
      })
    })
  })

  describe('and the v1 upload succeeds but the v2 upload fails', () => {
    beforeEach(async () => {
      uploadTilesJson
        .mockResolvedValueOnce(V1_URL)
        .mockRejectedValueOnce(new Error('S3 unavailable'))
      await startAndWaitUntilReady(3600)
    })

    it('should not expose any url for the redirect', () => {
      expect(map.getLastUploadedTilesUrl()).toEqual({})
    })
  })

  describe('and a later upload fails after a successful one', () => {
    beforeEach(async () => {
      uploadTilesJson
        .mockResolvedValueOnce(V1_URL)
        .mockResolvedValueOnce(V2_URL)
        .mockRejectedValue(new Error('S3 unavailable'))
      fetchUpdatedData.mockResolvedValue({
        tiles: [{ ...buildTile('1,1'), name: 'Updated' }],
        parcels: [],
        estates: [],
        updatedAt: 6000,
      })
      await startAndWaitUntilReady(0.001)
      await waitUntil(() => uploadTilesJson.mock.calls.length >= 3)
    })

    it('should stop exposing the outdated files for the redirect', () => {
      expect(map.getLastUploadedTilesUrl()).toEqual({})
    })
  })
})
