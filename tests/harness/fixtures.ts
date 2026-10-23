import { EventEmitter } from 'events'
import {
  IBaseComponent,
  IStatusCheckCapableComponent,
} from '@well-known-components/interfaces'
import { NFT } from '../../src/modules/api/types'
import { IMapComponent, Tile, TileType } from '../../src/modules/map/types'

export function buildTile(id: string, overrides: Partial<Tile> = {}): Tile {
  const [x, y] = id.split(',').map(Number)
  return {
    id,
    x,
    y,
    type: TileType.UNOWNED,
    top: false,
    left: false,
    topLeft: false,
    updatedAt: 1000,
    ...overrides,
  }
}

export function buildNFT(id: string, overrides: Partial<NFT> = {}): NFT {
  return {
    id,
    name: `NFT ${id}`,
    description: '',
    image: `http://images.test/${id}.png`,
    external_url: `http://marketplace.test/${id}`,
    background_color: '#000000',
    attributes: [],
    ...overrides,
  }
}

export type FixtureMapData = {
  tiles?: Tile[]
  /** Keyed by "x,y". */
  parcels?: Record<string, NFT>
  /** Keyed by estate id. */
  estates?: Record<string, NFT>
  /** Keyed by estate id. */
  dissolvedEstates?: Record<string, NFT>
  /** Keyed by "<contract address>-<token id>". */
  tokens?: Record<string, NFT>
  lastUpdatedAt?: number
  landVersion?: string
  lastUploadedTilesUrl?: { v1?: string; v2?: string }
  ready?: boolean
}

type Mocked<T> = {
  [K in keyof T]: T[K] extends (...args: any[]) => any
    ? jest.MockedFunction<T[K]>
    : T[K]
}

export type FixtureMap = Mocked<IMapComponent> &
  IBaseComponent &
  IStatusCheckCapableComponent & {
    setReady: (ready: boolean) => void
  }

/**
 * An in-memory map component serving fixed data, to pass as the `map` option
 * of startTestServer. Every method is a jest.fn so tests can re-program it.
 * @param data - the tiles, NFTs and state to serve
 * @returns the fixture map
 */
export function createFixtureMap(data: FixtureMapData = {}): FixtureMap {
  let ready = data.ready ?? true
  const tiles = Object.fromEntries(
    (data.tiles ?? []).map((tile) => [tile.id, tile])
  )

  return {
    events: new EventEmitter(),
    getTiles: jest.fn().mockImplementation(async () => tiles),
    getParcel: jest
      .fn()
      .mockImplementation(async (x, y) => data.parcels?.[`${x},${y}`] ?? null),
    getEstate: jest
      .fn()
      .mockImplementation(async (id) => data.estates?.[id] ?? null),
    getDissolvedEstate: jest
      .fn()
      .mockImplementation(async (id) => data.dissolvedEstates?.[id] ?? null),
    getToken: jest
      .fn()
      .mockImplementation(
        async (address, id) => data.tokens?.[`${address}-${id}`] ?? null
      ),
    isReady: jest.fn().mockImplementation(() => ready),
    getLastUpdatedAt: jest
      .fn()
      .mockImplementation(() => data.lastUpdatedAt ?? 0),
    getLandVersion: jest
      .fn()
      .mockImplementation(() => data.landVersion ?? '0000000000000000'),
    getLastUploadedTilesUrl: jest
      .fn()
      .mockImplementation(() => data.lastUploadedTilesUrl ?? {}),
    async startupProbe() {
      return ready
    },
    async readynessProbe() {
      return ready
    },
    setReady(value: boolean) {
      ready = value
    },
  }
}
