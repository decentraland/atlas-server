import { createFargateTask } from 'dcl-ops-lib/createFargateTask'
import { env, envTLD } from 'dcl-ops-lib/domain'

export = async function main() {
  const revision = process.env['CI_COMMIT_SHA']
  const image = `decentraland/atlas-server:${revision}`

  const hostname = 'api.decentraland.' + envTLD

  const api = await createFargateTask(
    `api`,
    image,
    5000,
    [
      { name: 'NODE_ENV', value: 'production' },
      {
        name: 'API_URL',
        value:
          env === 'prd' || env === 'stg'
            ? 'https://api.thegraph.com/subgraphs/name/decentraland/marketplace'
            : 'https://api.thegraph.com/subgraphs/name/decentraland/marketplace-ropsten',
      },
    ],
    hostname,
    {
      // @ts-ignore
      healthCheck: {
        path: '/v2/ping',
        interval: 60,
        timeout: 10,
        unhealthyThreshold: 10,
        healthyThreshold: 3,
      },
      version: '1',
      metrics: {
        path: '/metrics'
      },
      memoryReservation: 1024,
      cpuReservation: 1024,
      desiredCount: env === 'prd' ? 3 : 1,
      extraExposedServiceOptions: {
        createCloudflareProxiedSubdomain: true,
      },
    }
  )

  const publicUrl = api.endpoint

  return {
    publicUrl,
  }
}
