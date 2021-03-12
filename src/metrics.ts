import { IMetricsComponent } from '@well-known-components/interfaces'
import { validateMetricsDeclaration } from '@well-known-components/metrics'

export const metricDeclarations = {
  dcl_map_render_time: {
    help: 'map render time',
    buckets: [0.1, 5, 15, 50, 100, 500],
    type: IMetricsComponent.HistogramType,
    labelNames: ['status'],
  },
}

// type assertions
validateMetricsDeclaration(metricDeclarations)
