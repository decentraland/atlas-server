import { IMetricsComponent } from '@well-known-components/interfaces'
import { getDefaultHttpMetrics } from '@dcl/http-server'
import { validateMetricsDeclaration } from '@dcl/metrics'
import { metricDeclarations as theGraphMetrics } from '@dcl/thegraph-component'
import { metricDeclarations as loggerMetrics } from '@well-known-components/logger'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...loggerMetrics,
  ...theGraphMetrics,
  dcl_map_render_time: {
    help: 'map render time',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    type: IMetricsComponent.HistogramType,
    labelNames: ['status'],
  },
  dcl_mini_map_render_time: {
    help: 'map render time',
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    type: IMetricsComponent.HistogramType,
    labelNames: ['status'],
  },
  dcl_map_render_prepare_seconds: {
    help: 'time the main thread spends building a render job from the tiles',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    type: IMetricsComponent.HistogramType,
    labelNames: ['kind'],
  },
  dcl_map_render_errors_total: {
    help: 'map renders that failed, by why: busy, aborted, prepare, transport, worker_error or worker_crash',
    type: IMetricsComponent.CounterType,
    labelNames: ['kind', 'reason'],
  },
  dcl_map_render_wait_seconds: {
    help: 'time a map render waits for a render slot',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    type: IMetricsComponent.HistogramType,
    labelNames: ['result'],
  },
  dcl_map_image_cache_total: {
    help: 'map image requests by how they were answered: hit, miss, shared render or not_modified',
    type: IMetricsComponent.CounterType,
    labelNames: ['kind', 'result'],
  },
  dcl_map_image_cache_bytes: {
    help: 'bytes of rendered map images held in memory',
    type: IMetricsComponent.GaugeType,
  },
  dcl_map_update: {
    type: IMetricsComponent.CounterType,
    help: 'Updates',
    labelNames: ['type', 'status'],
  },
}

export type Metrics = typeof metricDeclarations

// type assertions
validateMetricsDeclaration(metricDeclarations)
