require('dotenv').config()
import { Server } from './server'

// Variables
const SUBGRAPH_URL = process.env.SUBGRAPH_URL
const SUBGRAPH_CONCURRENCY = parseInt(process.env.SUBGRAPH_CONCURRENCY!, 10)
const SUBGRAPH_REFRESH_INTERVAL = parseInt(
  process.env.SUBGRAPH_REFRESH_INTERVAL!,
  10
)

// Kick it
async function main() {
  const server = new Server({
    subgraphUrl: SUBGRAPH_URL,
    subgraphConcurrency: SUBGRAPH_CONCURRENCY,
    subgraphRefreshInterval: SUBGRAPH_REFRESH_INTERVAL,
  })

  await server.start()
}

main().catch((error) => console.error(error.message))
