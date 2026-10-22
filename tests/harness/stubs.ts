import { IFetchComponent } from '@dcl/core-commons'
import { IFeaturesComponent } from '@dcl/features-component'
import { IPgComponent } from '@dcl/pg-component'
import { ISubgraphComponent } from '@dcl/thegraph-component'
import { IBaseComponent } from '@well-known-components/interfaces'
import { IS3Component } from '../../src/modules/s3/component'
import { IMapComponent } from '../../src/modules/map/types'

export type SubgraphStub = ISubgraphComponent & {
  query: jest.MockedFunction<ISubgraphComponent['query']>
}

export type DatabaseStub = IPgComponent & {
  query: jest.Mock
}

export type S3Stub = {
  [K in keyof IS3Component]: jest.MockedFunction<IS3Component[K]>
}

export type FetchStub = IFetchComponent & {
  fetch: jest.MockedFunction<IFetchComponent['fetch']>
}

export type FeaturesStub = IFeaturesComponent & {
  getIsFeatureEnabled: jest.MockedFunction<
    IFeaturesComponent['getIsFeatureEnabled']
  >
}

/** The components the harness swaps in for the ones that reach outside the process. */
export type ExternalStubs = {
  subgraph: SubgraphStub
  batchSubgraph: SubgraphStub
  database: DatabaseStub
  s3: S3Stub
  fetch: FetchStub
  features: FeaturesStub
}

export type MapOverride = IMapComponent & Partial<IBaseComponent>

type HarnessState = {
  stubs: ExternalStubs | undefined
  map: MapOverride | undefined
  subgraphsCreated: number
}

// read by the jest.mock factories in ./server.ts while src/components.ts wires the app
export const harnessState: HarnessState = {
  stubs: undefined,
  map: undefined,
  subgraphsCreated: 0,
}

export function getStubs(): ExternalStubs {
  if (!harnessState.stubs) {
    throw new Error('The test server stubs are only available while starting')
  }
  return harnessState.stubs
}

function createSubgraphStub(): SubgraphStub {
  // never settles, so the real map stays "not ready" unless a test answers it
  return {
    query: jest.fn().mockImplementation(() => new Promise(() => undefined)),
  } as SubgraphStub
}

/**
 * Builds stubs for every external dependency. They answer as an empty,
 * unreachable world: the subgraph never answers, S3 has no cached tiles, the
 * database has no trades, outbound fetches fail and every feature is off.
 * @returns the stubs, whose jest.fn members tests can re-program
 */
export function createExternalStubs(): ExternalStubs {
  return {
    subgraph: createSubgraphStub(),
    batchSubgraph: createSubgraphStub(),
    database: {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      start: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseStub,
    s3: {
      uploadTilesJson: jest.fn().mockResolvedValue(''),
      uploadTimestamp: jest.fn().mockResolvedValue(undefined),
      getTilesJson: jest.fn().mockResolvedValue(null),
      getTimestamp: jest.fn().mockResolvedValue(null),
      getFileUrl: jest.fn().mockResolvedValue(''),
    },
    fetch: {
      fetch: jest
        .fn()
        .mockRejectedValue(new Error('Outbound fetch is stubbed in tests')),
    },
    features: {
      getIsFeatureEnabled: jest.fn().mockResolvedValue(false),
      getFeatureVariant: jest.fn().mockResolvedValue(null),
      getEnvFeature: jest.fn().mockResolvedValue(undefined),
    } as unknown as FeaturesStub,
  }
}
