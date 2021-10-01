// This file is the "test-environment" analogous for src/components.ts
// Here we define the test components to be used in the testing environment

import nodeFetch, { RequestInfo, RequestInit } from 'node-fetch'
import { IFetchComponent } from '@well-known-components/http-server'
import { createRunner } from '@well-known-components/test-helpers'

import { main } from '../src/service'
import { TestComponents } from '../src/types'
import { initComponents as originalInitComponents } from '../src/components'
import Sinon from 'sinon'

// start TCP port for listeners
let lastUsedPort = 19000 + parseInt(process.env.JEST_WORKER_ID || '1') * 1000
function getFreePort() {
  return lastUsedPort + 1
}

/**
 * Behaves like Jest "describe" function, used to describe a test for a
 * use case, it creates a whole new program and components to run an
 * isolated test.
 *
 * State is persistent within the steps of the test.
 */
export const test = createRunner<TestComponents>({
  main,
  initComponents,
})

async function initComponents(): Promise<TestComponents> {
  const currentPort = getFreePort()

  Object.assign(process.env, {
    HTTP_SERVER_PORT: (currentPort + 1).toString(),
    CATALYST_HOST: 'peer.decentraland.org',
  })

  const components = await originalInitComponents()

  const { config } = components

  const protocolHostAndProtocol = `http://${await config.requireString(
    'HTTP_SERVER_HOST'
  )}:${await config.requireNumber('HTTP_SERVER_PORT')}`

  // test fetch, to hit our local server
  const localFetch: IFetchComponent = {
    async fetch(url: RequestInfo, initRequest?: RequestInit) {
      if (typeof url == 'string' && url.startsWith('/')) {
        return nodeFetch(protocolHostAndProtocol + url, { ...initRequest })
      } else {
        throw new Error('localFetch only works for local testing-URLs')
      }
    },
  }

  return {
    ...components,
    map: Sinon.stub(components.map),
    localFetch,
  }
}
