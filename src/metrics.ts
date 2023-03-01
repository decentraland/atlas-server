import { IMetricsComponent } from '@well-known-components/interfaces'
import {
  getDefaultHttpMetrics,
  validateMetricsDeclaration,
} from '@well-known-components/metrics'
import { metricDeclarations as theGraphMetrics } from '@well-known-components/thegraph-component'
import { metricDeclarations as loggerMetrics } from '@well-known-components/logger'

export const metricDeclarations = {
  ...getDefaultHttpMetrics(),
  ...loggerMetrics,
  ...theGraphMetrics,
  dcl_map_render_time: {
    help: 'map render time',
    buckets: [0.1, 5, 15, 50, 100, 500],
    type: IMetricsComponent.HistogramType,
    labelNames: ['status'],
  },
  dcl_mini_map_render_time: {
    help: 'map render time',
    buckets: [0.1, 5, 15, 50, 100, 500],
    type: IMetricsComponent.HistogramType,
    labelNames: ['status'],
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
