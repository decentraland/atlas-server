import expect from 'expect'
import { test } from '../harness/test-runner'
import { Response } from 'node-fetch'
import { addInterceptor } from '../harness/testFetchComponent'

test('integration sanity tests using a real server backend', function ({
  components,
  stubComponents,
}) {

  it('mocks thegraph api', () => {
    const { fetch } = components
    addInterceptor(fetch, async (req) => {
      if(req.url.startsWith('https://api.thegraph.com')){
        console.dir(req)
        return new Response('{"data": {}}')
      }
    })
  })

  it('waits for map to be ready', async function () {
    this.timeout(60000)

    const { map } = components
    const tiles = await map.getTiles()
    const tilesAsArray = Object.values(tiles)

    expect(tilesAsArray.length).toBeGreaterThan(0)
  })
})
