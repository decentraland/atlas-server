import {
  IBaseComponent,
  IMetricsComponent,
  START_COMPONENT,
  STOP_COMPONENT,
} from '@well-known-components/interfaces'
import {
  createRenderPool,
  IRenderPoolComponent,
  RenderPoolOptions,
} from '../../src/adapters/render-pool'
import { Metrics } from '../../src/metrics'

// transpiled by the jest globalSetup
const { COMPILED_RENDER_WORKER } = require('../harness/compile-render-worker')

export type StartedRenderPool = {
  pool: IRenderPoolComponent
  startTimer: jest.Mock
  endWaitTimer: jest.Mock
  observe: jest.Mock
  stop: () => Promise<void>
}

/** Starts a real render pool, with worker threads, and mocked metrics. Call stop() in afterEach. */
export async function startRenderPool(
  options: Partial<RenderPoolOptions> = {}
): Promise<StartedRenderPool> {
  const endWaitTimer = jest.fn()
  const startTimer = jest.fn(() => ({ end: endWaitTimer }))
  const observe = jest.fn()
  const pool = createRenderPool(
    {
      metrics: { startTimer, observe } as unknown as IMetricsComponent<
        keyof Metrics
      >,
    },
    {
      maxThreads: 1,
      maxQueued: 8,
      maxWaitMs: 5000,
      workerFilename: COMPILED_RENDER_WORKER,
      ...options,
    }
  )
  await pool[START_COMPONENT]!({} as IBaseComponent.ComponentStartOptions)
  return {
    pool,
    startTimer,
    endWaitTimer,
    observe,
    stop: () => pool[STOP_COMPONENT]!(),
  }
}
