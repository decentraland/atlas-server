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
 * The external factories are replaced by ./mocks.ts, a setupFiles entry of the
 * "http" jest project, so route tests must live under tests/http.
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

const STUBBED_FACTORIES = [
  'createSubgraphComponent',
  'createPgComponent',
  'createTracedFetcherComponent',
  'createFeaturesComponent',
  'createS3Component',
  'createMapComponent',
]

function assertExternalFactoriesStubbed() {
  const missing = STUBBED_FACTORIES.filter(
    (name) => !harnessState.stubbedFactories.has(name)
  )
  if (missing.length > 0) {
    throw new Error(
      `The app was wired with the real ${missing.join(', ')}: ` +
        'tests using the server harness must live under tests/http'
    )
  }
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
  harnessState.stubbedFactories.clear()

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

  // wired outside Lifecycle.run, which exits the process instead of rejecting
  let components: AppComponents
  try {
    components = await initComponents()
    assertExternalFactoriesStubbed()
  } catch (error) {
    restore()
    throw error
  }
  const program = await Lifecycle.run<AppComponents>({
    main,
    initComponents: async () => components,
  })

  const server = await getUnderlyingServer<Server>(program.components.server)
  const { port } = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${port}`
  const responses: Response[] = []

  return {
    baseUrl,
    components: program.components,
    stubs,
    async fetch(path, init) {
      const response = await fetch(`${baseUrl}${path}`, init)
      responses.push(response)
      return response
    },
    async stop() {
      try {
        // release the sockets of bodies a test never read
        await Promise.all(
          responses.map((response) =>
            response.bodyUsed
              ? undefined
              : response.body?.cancel().catch(() => undefined)
          )
        )
        await program.stop()
      } finally {
        restore()
      }
    },
  }
}
