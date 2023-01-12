import * as pulumi from '@pulumi/pulumi'
import { createFargateTask } from 'dcl-ops-lib/createFargateTask'
import { createImageFromContext } from 'dcl-ops-lib/createImageFromContext'
import { prometheusStack } from 'dcl-ops-lib/prometheus'
import { env, envTLD, publicTLD } from 'dcl-ops-lib/domain'

export = async function main() {
  const revision = process.env['CI_COMMIT_SHA']
  const registry = createImageFromContext('atlas-server', '..', {})
  const hostname = `api.decentraland.${env === 'prd' ? publicTLD : envTLD}`

  const prometheus = await prometheusStack()

  const api = await createFargateTask(
    `api`,
    registry.image.imageName,
    5000,
    [
      { name: 'NODE_ENV', value: 'production' },
      {
        name: 'SUBGRAPH_URL',
        value:
          env === 'prd' || env === 'stg'
            ? 'https://api.thegraph.com/subgraphs/name/decentraland/marketplace'
            : 'https://api.thegraph.com/subgraphs/name/decentraland/marketplace-goerli',
      },
      {
        name: 'SUBGRAPH_COMPONENT_QUERY_TIMEOUT',
        value: '30000',
      },
      {
        name: 'IMAGE_BASE_URL',
        value:
          env === 'prd' || env === 'stg'
            ? 'https://api.decentraland.org/v2'
            : 'https://api.decentraland.zone/v2',
      },
      {
        name: 'EXTERNAL_BASE_URL',
        value:
          env === 'prd' || env === 'stg'
            ? 'https://market.decentraland.org'
            : 'https://market.decentraland.zone',
      },
      {
        name: 'LAND_CONTRACT_ADDRESS',
        value:
          env === 'prd' || env === 'stg'
            ? '0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d'
            : '0x25b6B4bac4aDB582a0ABd475439dA6730777Fbf7',
      },
      {
        name: 'ESTATE_CONTRACT_ADDRESS',
        value:
          env === 'prd' || env === 'stg'
            ? '0x959e104e1a4db6317fa58f8295f586e1a978c297'
            : '0xC9A46712E6913c24d15b46fF12221a79c4e251DC',
      },
      { name: 'CORS_ORIGIN', value: '*' },
      { name: 'CORS_METHOD', value: '*' },
      {
        name: 'WKC_METRICS_BEARER_TOKEN',
        value: prometheus.getOutput('serviceMetricsBearerToken'),
      },
      {
        name: 'SIGNATURES_SERVER_URL',
        value: `https://signatures-api.decentraland.${publicTLD}`,
      },
    ],
    hostname,
    {
      // @ts-ignore
      healthCheck: {
        path: '/health/live',
        interval: 60,
        timeout: 10,
        unhealthyThreshold: 10,
        healthyThreshold: 3,
      },
      version: '1',
      metrics: {
        path: '/metrics',
      },
      memoryReservation: 1024,
      cpuReservation: 1024,
      desiredCount: env === 'prd' ? 3 : 1,
      extraExposedServiceOptions: {
        createCloudflareProxiedSubdomain: true,
      },
      team: 'dapps',
    }
  )

  const publicUrl = api.endpoint

  return {
    publicUrl,
  }
}
