# atlas-server

🗺 A server for the atlas map

## Setup

1. Run `npm install`
2. Run `npm run build`
3. Run `npm start`

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

### Tiles

- `/v1/tiles`: Returns all the tiles in the map, with the legacy format:

```
{
  type: number
  x: number
  y: number
  owner?: string
  estate_id?: string
  name?: string
  top?: number
  left?: number
  topLeft?: number
  price?: number
}
```

This endpoint has been **deprecated**, you should use the `/v2/tiles` endpoint, more info below.

- `/v2/tiles`: Returns all the tiles in the map, with the following format:

```
{
  id: string
  x: number
  y: number
  type: 'owned' | 'unowned' | 'plaza' | 'road' | 'district'
  top: boolean
  left: boolean
  topLeft: boolean
  updatedAt: number
  name?: string
  owner?: string
  estateId?: string
  tokenId?: string
  price?: number
}
```

**Filter**: You can filter the results and the payloads using the following query params:

- `x1,y1,x2,y2`: You can request just a piece of the map, for example this will only return tiles between `10,10` and `20,20`:

```
/v2/tiles?x1=10&y1=10&x2=20&y2=20
```

- `include`: You can select which fields to include in each tile, for example this would include only `type`, `top`, `left` and `topLeft`:

```
/v2/tiles?include=type,top,left,topLeft
```

- `exclude`: The opposite to the filter above, the fields you pass in this filter will be excluded from each tile, for example if you don't cate about the `updatedAt` and `tokenId` fields you can do:

```
/v2/tiles?exclude=updatedAt,tokenId
```

### Map

- `/v1/map.png`: This endpoint returns a PNG of the genesis map. You can customize the following via query params:

  - `width`: The width in pixels of the image, ie: `?width=1024`

  - `height`: The height in pixels of the image, ie: `?height=1024`

  - `size`: The size in pixels of each tile, for instance if `size` is `10`, all the tiles will be 10x10px, ie: `?size=10`

  - `center`: The coords on which to center the map, ie: `?center=20,20`

  - `selected`: A list of coords to be highlighted, separated with semicolons, ie: `?selected=10,10;10,11;11,10;11,11`

  - `on-sale`: If true, the parcels and estates on sale will be displayed in blue.

Example:

```
/v1/map.png?center=23,-23&selected=23,-23&size=20&width=2048&height=2048
```

![example](https://user-images.githubusercontent.com/2781777/100786738-5324fd00-33f1-11eb-93c0-41bfe0bc799c.png)

- `/v1/parcels/:x/:y/map.png`: This endpoint returns a PNG of the map already centered and highlighting a Parcel. You can also adjust `width`, `height` and `size` via query params

- `/v1/estates/:id/map.png`: This endpoint returns a PNG of the map already centered and highlighting an Estate. You can also adjust `width`, `height` and `size` via query params

- `/v2/parcels/:x/:y`: This endpoint returns metadata about a parcel by passing its coordinates. The metadata uses the [OpenSea Metadata Standard](https://docs.opensea.io/docs/metadata-standards).

- `/v2/estates/:id`: This endpoint returns metadata about an estate by passing its id. The metadata uses the [OpenSea Metadata Standard](https://docs.opensea.io/docs/metadata-standards).

- `/v2/contracts/:address/tokens/:id`: This endpoint returns metadata about a parcel or an estate, by passing the contract address and the token id. The contract address for LAND on mainnet is `0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d` and the contract address for Estate on mainnet is `0x959e104e1a4db6317fa58f8295f586e1a978c297`. The metadata uses the [OpenSea Metadata Standard](https://docs.opensea.io/docs/metadata-standards).

- `/v2/districts`: Returns a list of all Districts in Genesis City.

- `/v2/districts/:id`: Returns a specific district by `id`.

- `/v2/addresses/:address/contributions`: Returns a list of contributions made by specific address. Each contribution includes the amount of parcels and the district `id` they were contributed to.

### Troubleshooting

- Installing `node-canvas` on Apple M1:

If the `npm install` fails on the dependency `node-canvas` and you are running on an Apple M1 chip, try installing these dependencies via brew: `brew install pkg-config cairo pango libpng jpeg giflib librsvg`.
