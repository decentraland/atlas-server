import {
  IBaseComponent,
  IConfigComponent,
} from '@well-known-components/interfaces'
import { IApiComponent, NFT, Result } from '../../src/modules/api/types'
import { createMapComponent } from '../../src/modules/map/component'
import { IMapComponent, MapEvents } from '../../src/modules/map/types'
import { IS3Component } from '../../src/modules/s3/component'
import { ITradesComponent } from '../../src/modules/trades/component'
import { AppComponents } from '../../src/types'

const CHECKSUMMED_LAND_CONTRACT_ADDRESS =
  '0xF87E31492Faf9A91B02Ee0dEAAd50d51d56D5d4d'

function buildNft(id: string): NFT {
  return {
    id,
    name: `Parcel ${id}`,
    description: '',
    image: '',
    external_url: '',
    background_color: '000000',
    attributes: [],
  }
}

describe('when looking up a token in the map', () => {
  let map: IMapComponent & IBaseComponent
  let parcel: NFT

  beforeEach(async () => {
    parcel = buildNft('42')
    const result: Result = {
      tiles: [],
      parcels: [parcel],
      estates: [],
      updatedAt: 1000,
    }
    const config = {
      requireNumber: jest.fn().mockResolvedValue(60),
      requireString: jest.fn((name: string) =>
        Promise.resolve(
          name === 'ESTATE_CONTRACT_ADDRESS'
            ? '0x959e104e1a4db6317fa58f8295f586e1a978c297'
            : CHECKSUMMED_LAND_CONTRACT_ADDRESS
        )
      ),
    } as unknown as IConfigComponent
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      log: jest.fn(),
    }
    map = await createMapComponent({
      config,
      logs: { getLogger: () => logger },
      s3: {
        getTilesJson: jest.fn().mockResolvedValue(null),
        getTimestamp: jest.fn().mockResolvedValue(null),
        uploadTilesJson: jest.fn().mockResolvedValue('https://cdn.example.com'),
        getFileUrl: jest.fn().mockResolvedValue('https://cdn.example.com'),
        uploadTimestamp: jest.fn().mockResolvedValue(undefined),
      } as unknown as IS3Component,
      trades: {
        getActiveTrades: jest.fn().mockResolvedValue([]),
      } as unknown as ITradesComponent,
      tracer: {
        span: (_name: string, fn: () => unknown) => fn(),
      } as unknown as AppComponents['tracer'],
      api: {
        fetchUpdatedData: jest
          .fn()
          .mockResolvedValue({ ...result, parcels: [] }),
      } as unknown as IApiComponent,
      batchApi: {
        fetchData: jest.fn().mockResolvedValue(result),
      } as unknown as IApiComponent,
    })
    const ready = new Promise((resolve) =>
      map.events.once(MapEvents.READY, resolve)
    )
    await map.start!({} as any)
    await ready
  })

  afterEach(async () => {
    await map.stop!()
  })

  describe('and the address is lowercased while the configured one is checksummed', () => {
    it('should find the token', async () => {
      await expect(
        map.getToken(CHECKSUMMED_LAND_CONTRACT_ADDRESS.toLowerCase(), '42')
      ).resolves.toEqual(parcel)
    })
  })

  describe('and the address is checksummed', () => {
    it('should find the token', async () => {
      await expect(
        map.getToken(CHECKSUMMED_LAND_CONTRACT_ADDRESS, '42')
      ).resolves.toEqual(parcel)
    })
  })
})
