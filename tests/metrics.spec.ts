import { createTestMetricsComponent } from '@dcl/metrics'
import { metricDeclarations } from '../src/metrics'

describe('when declaring the render time metrics', () => {
  it.each(['dcl_map_render_time', 'dcl_mini_map_render_time'] as const)(
    'should give %p buckets that cover sub-second renders',
    (name) => {
      expect(metricDeclarations[name].buckets).toEqual([
        0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
      ])
    }
  )
})

describe('when registering the service metrics', () => {
  let metrics: ReturnType<
    typeof createTestMetricsComponent<keyof typeof metricDeclarations>
  >

  beforeEach(() => {
    metrics = createTestMetricsComponent(metricDeclarations)
  })

  describe('and the registered metric names are listed', () => {
    let names: string[]

    beforeEach(() => {
      names = metrics.registry.getMetricsAsArray().map((metric) => metric.name)
    })

    it('should include the render times, the render wait and the map updates next to the HTTP, logger and subgraph metrics', () => {
      expect(names).toEqual(
        expect.arrayContaining([
          'dcl_map_render_time',
          'dcl_mini_map_render_time',
          'dcl_map_render_wait_seconds',
          'dcl_map_update',
          'http_requests_total',
          'wkc_logger_logs_total',
          'subgraph_query_duration_seconds',
        ])
      )
    })
  })

  describe('and a map render is timed', () => {
    let exposition: string

    beforeEach(async () => {
      metrics.startTimer('dcl_map_render_time').end({ status: 200 })
      exposition = await metrics.registry.metrics()
    })

    it('should record it labelled by status', () => {
      expect(exposition).toContain('dcl_map_render_time_count{status="200"} 1')
    })
  })

  describe('and a map update is counted', () => {
    let exposition: string

    beforeEach(async () => {
      metrics.increment('dcl_map_update', { type: 'tiles', status: 'success' })
      exposition = await metrics.registry.metrics()
    })

    it('should record it labelled by type and status', () => {
      expect(exposition).toContain(
        'dcl_map_update{type="tiles",status="success"} 1'
      )
    })
  })
})
