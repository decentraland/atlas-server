import { District } from '../../src/modules/district/types'
import { test } from '../components'
import { Response } from 'node-fetch'
import Sinon from 'sinon'
import { getCatalystBaseUrl } from '../../src/controllers/fetcher-functions'

test('test snapshots', function ({ components, stubComponents }) {
  it('fetches by hash', async () => {
    const { deployedScenes } = components
    const { fetcher } = stubComponents

    const catalystUrl = await getCatalystBaseUrl(components)

    fetcher.fetch.withArgs('https://peer.decentraland.org/content/snapshot/scenes').resolves(
      new Response(
        JSON.stringify({
          hash: 'asd', // <---------
          lastIncludedDeploymentTimestamp: 123,
        })
      )
    )

    fetcher.fetch
      .withArgs(catalystUrl + '/content/contents/asd')
      .resolves(new Response(JSON.stringify([['Qm1', ['0,0']]])))

    const r = await deployedScenes.getScenes()

    fetcher.fetch

    expect(r).toEqual([['Qm1', ['0,0']]])
  })
})
