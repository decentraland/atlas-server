/**
 * setupFiles entry of the "http" jest project (see jest.config.js): replaces
 * the factories that reach outside the process with the stubs of ./stubs.ts,
 * before any test file can load src/.
 */

function mockStubbed<T>(factory: string, pick: (stubs: any) => T): T {
  const { harnessState, getStubs } = require('./stubs')
  harnessState.stubbedFactories.add(factory)
  return pick(getStubs())
}

jest.mock('@dcl/thegraph-component', () => ({
  ...jest.requireActual('@dcl/thegraph-component'),
  // components.ts creates the live subgraph first and the batch one second
  createSubgraphComponent: async () =>
    mockStubbed('createSubgraphComponent', (stubs) =>
      require('./stubs').harnessState.subgraphsCreated++ === 0
        ? stubs.subgraph
        : stubs.batchSubgraph
    ),
}))

// not spreading the actual module: jest cannot resolve pg's export map from pg-cursor
jest.mock('@dcl/pg-component', () => ({
  createPgComponent: async () =>
    mockStubbed('createPgComponent', (stubs) => stubs.database),
}))

jest.mock('@dcl/traced-fetch-component', () => ({
  ...jest.requireActual('@dcl/traced-fetch-component'),
  createTracedFetcherComponent: async () =>
    mockStubbed('createTracedFetcherComponent', (stubs) => stubs.fetch),
}))

jest.mock('@dcl/features-component', () => ({
  ...jest.requireActual('@dcl/features-component'),
  createFeaturesComponent: async () =>
    mockStubbed('createFeaturesComponent', (stubs) => stubs.features),
}))

jest.mock('../../src/modules/s3/component', () => ({
  ...jest.requireActual('../../src/modules/s3/component'),
  createS3Component: async () =>
    mockStubbed('createS3Component', (stubs) => stubs.s3),
}))

jest.mock('../../src/modules/map/component', () => {
  const actual = jest.requireActual('../../src/modules/map/component')
  return {
    ...actual,
    createMapComponent: async (components: unknown) => {
      mockStubbed('createMapComponent', () => undefined)
      return (
        require('./stubs').harnessState.map ??
        actual.createMapComponent(components)
      )
    },
  }
})

// the real map never becomes ready under the stubs, so the bar's redraw timer would outlive the test on a TTY
jest.mock('cli-progress', () => ({
  SingleBar: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    update: jest.fn(),
    stop: jest.fn(),
  })),
}))
