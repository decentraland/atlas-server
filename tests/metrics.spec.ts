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
