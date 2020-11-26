# atlas-server

🗺 A server for the atlas map

## Setup

1. Run `npm install`
2. Run `npm start`

## Config

The env variables and their default values are the following:

```
PORT=5000
HOST=0.0.0.0
API_URL=https://api.thegraph.com/subgraphs/name/decentraland/marketplace
API_BATCH_SIZE=1000
API_CONCURRENCY=10
REFRESH_INTERVAL=60
```

You can `cp .env.example .env` and tweak the ones you want to change

## Endpoints

- `/v1/tiles`: Returns the same data as `https://api.decentraland.org/v1/tiles`

- `/v2/tiles`: Returns all the tiles in the map, but with the following format:

```
{
  id: string
  x: number
  y: number
  type: 'owned' | 'unowned' | 'plaza' | 'road' | 'district'
  name: string
  top: boolean
  left: boolean
  topLeft: boolean
  updatedAt: number
  owner: string | null
  estateId: string | null
  tokenId: string | null
  price: number | null
}
```
