/**
 * Starts the real HTTP server through the app's own wiring (initComponents +
 * main under Lifecycle.run, as src/index.ts does) on a random local port, with
 * every component that reaches outside the process replaced by a stub.
 *
 * Usage (beforeEach / afterEach):
 *   server = await startTestServer({ map: createFixtureMap({ tiles }) })
 *   response = await server.fetch('/v2/tiles')
 *   await server.stop()
 *
 * Import this module before anything from src/ so its jest.mock calls apply.
 * As in production, Lifecycle.run exits the process if the wiring throws.
 */
import { AddressInfo } from 'net'
import { Server } from 'http'
import { getUnderlyingServer } from '@dcl/http-server'
import { Lifecycle } from '@well-known-components/interfaces'
import { initComponents } from '../../src/components'
import { main } from '../../src/service'
import { AppComponents } from '../../src/types'
import {
  createExternalStubs,
  ExternalStubs,
  harnessState,
  MapOverride,
} from './stubs'

jest.mock('@dcl/thegraph-component', () => {
  const actual = jest.requireActual('@dcl/thegraph-component')
  return {
    ...actual,
    // components.ts creates the live subgraph first and the batch one second
    createSubgraphComponent: async () => {
      const { harnessState, getStubs } = require('./stubs')
      const { subgraph, batchSubgraph } = getStubs()
      return harnessState.subgraphsCreated++ === 0 ? subgraph : batchSubgraph
    },
  }
})

// not spreading the actual module: jest cannot resolve pg's export map from pg-cursor
jest.mock('@dcl/pg-component', () => ({
  createPgComponent: async () => require('./stubs').getStubs().database,
}))

jest.mock('@dcl/traced-fetch-component', () => ({
  ...jest.requireActual('@dcl/traced-fetch-component'),
  createTracedFetcherComponent: async () => require('./stubs').getStubs().fetch,
}))

jest.mock('@dcl/features-component', () => ({
  ...jest.requireActual('@dcl/features-component'),
  createFeaturesComponent: async () => require('./stubs').getStubs().features,
}))

jest.mock('../../src/modules/s3/component', () => ({
  ...jest.requireActual('../../src/modules/s3/component'),
  createS3Component: async () => require('./stubs').getStubs().s3,
}))

jest.mock('../../src/modules/map/component', () => {
  const actual = jest.requireActual('../../src/modules/map/component')
  return {
    ...actual,
    createMapComponent: async (components: unknown) =>
      require('./stubs').harnessState.map ??
      actual.createMapComponent(components),
  }
})

export const TEST_LAND_CONTRACT_ADDRESS =
  '0x0000000000000000000000000000000000001a2d'
export const TEST_ESTATE_CONTRACT_ADDRESS =
  '0x000000000000000000000000000000000000e57a'

const DEFAULT_ENV: Record<string, string> = {
  HTTP_SERVER_HOST: '127.0.0.1',
  HTTP_SERVER_PORT: '0',
  CORS_ORIGIN: '*',
  CORS_METHOD: '*',
  SUBGRAPH_URL: 'http://subgraph.test/marketplace',
  SIGNATURES_SERVER_URL: 'http://signatures.test',
  ATLAS_SERVER_URL: 'http://atlas.test',
  LAND_CONTRACT_ADDRESS: TEST_LAND_CONTRACT_ADDRESS,
  ESTATE_CONTRACT_ADDRESS: TEST_ESTATE_CONTRACT_ADDRESS,
  REFRESH_INTERVAL: '60',
  AWS_S3_BUCKET: '',
  CDN_URL: '',
}

// lines printed by the WKC logger and Lifecycle, e.g. "... [INFO] (http-server): ..."
const APP_LOG_LINE = /\[(DEBUG|INFO|LOG|WARN|ERROR)\] \(/

function silenceAppOutput(): jest.SpyInstance[] {
  const writeToStderr = process.stderr.write.bind(process.stderr)
  const stderrSpy = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(((chunk: string | Uint8Array, ...rest: any[]) =>
      APP_LOG_LINE.test(String(chunk))
        ? true
        : writeToStderr(chunk, ...rest)) as typeof process.stderr.write)
  const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(
    (method) => jest.spyOn(console, method).mockImplementation(() => undefined)
  )
  return [stderrSpy, ...consoleSpies]
}

export type TestServerOptions = {
  /** Replaces the map component, e.g. with createFixtureMap(). Defaults to the real map fed by the stubs. */
  map?: MapOverride
  /** Extra environment variables, read by the config component. */
  env?: Record<string, string>
  /** Re-program the external stubs before the components are created. */
  configureStubs?: (stubs: ExternalStubs) => void
  /** Keep the app's console output (silenced by default). */
  verbose?: boolean
}

export type TestServer = {
  /** e.g. http://127.0.0.1:54321 */
  baseUrl: string
  components: AppComponents
  stubs: ExternalStubs
  /** Native fetch against the server; `path` is relative to baseUrl. */
  fetch: (path: string, init?: RequestInit) => Promise<Response>
  stop: () => Promise<void>
}

/**
 * Starts the app on a random port. Call `stop()` in afterEach.
 * @param options - map override, env and stub programming
 * @returns the running server, its components and the stubs it uses
 */
export async function startTestServer(
  options: TestServerOptions = {}
): Promise<TestServer> {
  const env = { ...DEFAULT_ENV, ...options.env }
  const previousEnv = new Map(
    Object.keys(env).map((key) => [key, process.env[key]])
  )
  Object.assign(process.env, env)

  const outputSpies = options.verbose ? [] : silenceAppOutput()

  const stubs = createExternalStubs()
  options.configureStubs?.(stubs)
  harnessState.stubs = stubs
  harnessState.map = options.map
  harnessState.subgraphsCreated = 0

  function restore() {
    harnessState.stubs = undefined
    harnessState.map = undefined
    for (const spy of outputSpies) {
      spy.mockRestore()
    }
    for (const [key, value] of previousEnv) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }

  let program: Lifecycle.ComponentBasedProgram<AppComponents>
  try {
    program = await Lifecycle.run<AppComponents>({ main, initComponents })
  } catch (error) {
    restore()
    throw error
  }

  const server = await getUnderlyingServer<Server>(program.components.server)
  const { port } = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${port}`

  return {
    baseUrl,
    components: program.components,
    stubs,
    fetch: (path, init) => fetch(`${baseUrl}${path}`, init),
    async stop() {
      try {
        await program.stop()
      } finally {
        restore()
      }
    },
  }
}
