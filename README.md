# Atlas Server

[![Coverage Status](https://coveralls.io/repos/github/decentraland/atlas-server/badge.svg?branch=master)](https://coveralls.io/github/decentraland/atlas-server?branch=master)

The Atlas Server is a comprehensive API solution designed for the Decentraland Genesis City map. This service provides tile data, map image generation, parcel and estate metadata, and district information for the Decentraland ecosystem.

This server interacts with The Graph subgraph for on-chain marketplace data, PostgreSQL for trades data, AWS S3 or MinIO for map image storage, and the Signatures Server for rental listings to provide a complete atlas experience for Decentraland applications.

## Table of Contents

- [Features](#features)
- [Dependencies & Related Services](#dependencies--related-services)
- [API Documentation](#api-documentation)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
  - [Running the Service](#running-the-service)
- [Testing](#testing)
- [How to Contribute](#how-to-contribute)
- [License](#license)

## Features

- **Tile Data**: Serve all map tiles with comprehensive metadata (ownership, pricing, estate info, rental status) in v1 (legacy) and v2 formats
- **Map Image Generation**: Generate PNG images of the Genesis City map with customizable dimensions, zoom, and highlighted selections
- **Parcel Metadata**: Provide parcel details using the [OpenSea Metadata Standard](https://docs.opensea.io/docs/metadata-standards) for marketplace compatibility
- **Estate Metadata**: Provide estate details with size, parcels list, and OpenSea-compatible metadata
- **District Information**: Serve Genesis City districts data and user contributions
- **Mini-Map Rendering**: Generate optimized mini-map images for embedded views
- **Rental Integration**: Include rental listing information for LAND parcels and estates
- **Caching & Performance**: Efficient caching with Last-Modified headers and S3 storage for generated assets

## Dependencies & Related Services

This service interacts with the following services:

- **[Decentraland Marketplace](https://github.com/decentraland/marketplace)**: Frontend that displays the atlas map
- **[Decentraland Explorer](https://github.com/decentraland/explorer)**: Uses atlas for world navigation

External dependencies:

- **The Graph Subgraph**: Marketplace subgraph for on-chain parcel, estate, and order data
- **PostgreSQL**: Database for trades data (via dapps database)
- **AWS S3 or MinIO**: Object storage for generated map images and tile data
- **Signatures Server**: Rental listings data for LAND parcels

## API Documentation

### Base URL

The service runs on port `5000` by default.

### Authentication

All endpoints are public and do not require authentication.

### Key Endpoints

| Category      | Endpoint                                   | Description                                    |
| ------------- | ------------------------------------------ | ---------------------------------------------- |
| Health        | `GET /v2/ping`                             | Service health check                           |
| Health        | `GET /v2/ready`                            | Service readiness check                        |
| Tiles         | `GET /v1/tiles`                            | Get all tiles (legacy format) - **Deprecated** |
| Tiles         | `GET /v2/tiles`                            | Get all tiles (current format)                 |
| Tiles         | `GET /v2/tiles/info`                       | Get tiles metadata/info                        |
| Map           | `GET /v1/map.png`                          | Generate map image                             |
| Map           | `GET /v2/map.png`                          | Generate map image (v2)                        |
| Map           | `GET /v1/minimap.png`                      | Generate mini-map image                        |
| Map           | `GET /v1/estatemap.png`                    | Generate estate map image                      |
| Parcels       | `GET /v1/parcels/:x/:y/map.png`            | Generate map centered on parcel                |
| Parcels       | `GET /v2/parcels/:x/:y`                    | Get parcel metadata (OpenSea format)           |
| Estates       | `GET /v1/estates/:id/map.png`              | Generate map centered on estate                |
| Estates       | `GET /v2/estates/:id`                      | Get estate metadata (OpenSea format)           |
| Tokens        | `GET /v2/contracts/:address/tokens/:id`    | Get token metadata by contract                 |
| Districts     | `GET /v2/districts`                        | List all districts                             |
| Districts     | `GET /v2/districts/:id`                    | Get district details                           |
| Contributions | `GET /v2/addresses/:address/contributions` | Get user contributions                         |

### Tiles Endpoint

The `/v2/tiles` endpoint returns all tiles in the map with the following format:

```json
{
  "id": "string",
  "x": "number",
  "y": "number",
  "type": "'owned' | 'unowned' | 'plaza' | 'road' | 'district'",
  "top": "boolean",
  "left": "boolean",
  "topLeft": "boolean",
  "updatedAt": "number",
  "name": "string (optional)",
  "owner": "string (optional)",
  "estateId": "string (optional)",
  "tokenId": "string (optional)",
  "price": "number (optional)"
}
```

**Query Parameters:**

| Parameter     | Description                       | Example                          |
| ------------- | --------------------------------- | -------------------------------- |
| `x1,y1,x2,y2` | Filter tiles by coordinates range | `?x1=10&y1=10&x2=20&y2=20`       |
| `include`     | Select specific fields to include | `?include=type,top,left,topLeft` |
| `exclude`     | Exclude specific fields           | `?exclude=updatedAt,tokenId`     |

### Map Image Endpoint

The `/v1/map.png` endpoint generates a PNG of the Genesis City map with customization options:

| Parameter  | Description                               | Example                       |
| ---------- | ----------------------------------------- | ----------------------------- |
| `width`    | Image width in pixels                     | `?width=1024`                 |
| `height`   | Image height in pixels                    | `?height=1024`                |
| `size`     | Tile size in pixels                       | `?size=10`                    |
| `center`   | Map center coordinates                    | `?center=20,20`               |
| `selected` | Highlighted parcels (semicolon-separated) | `?selected=10,10;10,11;11,10` |
| `on-sale`  | Highlight parcels on sale in blue         | `?on-sale=true`               |

**Example:**

```
/v1/map.png?center=23,-23&selected=23,-23&size=20&width=2048&height=2048
```

### Parcel/Estate Metadata

The `/v2/parcels/:x/:y` and `/v2/estates/:id` endpoints return metadata following the [OpenSea Metadata Standard](https://docs.opensea.io/docs/metadata-standards).

**Contract Addresses (Mainnet):**

- LAND: `0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d`
- Estate: `0x959e104e1a4db6317fa58f8295f586e1a978c297`

## Getting Started

### Prerequisites

Before running this service, ensure you have the following installed:

- **Node.js**: Version 18 or higher
- **npm**: Package manager
- **Docker**: For containerized development (MinIO)

**Apple M1 Users**: If `npm install` fails on `node-canvas`, install these dependencies:

```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

### Installation

1. Clone the repository:

```bash
git clone https://github.com/decentraland/atlas-server.git
cd atlas-server
```

2. Install dependencies:

```bash
npm install
```

3. Build the project:

```bash
npm run build
```

### Configuration

The service uses environment variables for configuration. Create a `.env` file:

```bash
cp .env.example .env
```

Key configuration variables:

| Variable                           | Default                                                            | Description                     |
| ---------------------------------- | ------------------------------------------------------------------ | ------------------------------- |
| `PORT`                             | `5000`                                                             | Server port                     |
| `HOST`                             | `0.0.0.0`                                                          | Server host                     |
| `SUBGRAPH_URL`                     | `https://api.thegraph.com/subgraphs/name/decentraland/marketplace` | The Graph subgraph URL          |
| `SUBGRAPH_COMPONENT_QUERY_TIMEOUT` | `30000`                                                            | Subgraph query timeout (ms)     |
| `API_BATCH_SIZE`                   | `1000`                                                             | Batch size for API queries      |
| `API_CONCURRENCY`                  | `10`                                                               | Concurrent API requests         |
| `REFRESH_INTERVAL`                 | `60`                                                               | Data refresh interval (seconds) |
| `AWS_ACCESS_KEY_ID`                | `admin`                                                            | S3/MinIO access key             |
| `AWS_SECRET_ACCESS_KEY`            | `password`                                                         | S3/MinIO secret key             |
| `AWS_S3_BUCKET`                    | `atlas-server`                                                     | S3 bucket name                  |
| `AWS_S3_REGION`                    | `us-east-1`                                                        | S3 region                       |
| `AWS_S3_ENDPOINT`                  | `http://0.0.0.0:9000`                                              | S3/MinIO endpoint               |

### Running the Service

#### Setting up the environment

Start the MinIO service for local object storage:

```bash
docker-compose up -d
```

This will start:

- MinIO on port `9000` (API) and `9001` (Console UI)

#### Running in development mode

To run the service in development mode with hot reload:

```bash
npm run start:dev
```

To run in production mode:

```bash
npm run build
npm start
```

## Testing

This service includes test coverage.

### Running Tests

Run all tests:

```bash
npm test
```

### Test Structure

- **Unit Tests**: Located in `tests/` - Test adapters, logic, and modules
  - `tests/adapters/` - Adapter tests (legacy-tiles, rentals)
  - `tests/logic/` - Logic tests (error handling, middleware, NFTs)
  - `tests/modules/` - Module tests (api, rentals, trades)

## Troubleshooting

### Installing node-canvas on Apple M1

If the `npm install` fails on the dependency `node-canvas` and you are running on an Apple M1 chip, install these dependencies via brew:

```bash
brew install pkg-config cairo pango libpng jpeg giflib librsvg
```

## AI Agent Context

For detailed AI Agent context, see [docs/ai-agent-context.md](docs/ai-agent-context.md).

---

**Note**: Remember to configure your environment variables before running the service. The service requires access to The Graph subgraph and optionally S3/MinIO for image storage to function properly.

### Migrations

<!-- Remove this section if the service does not have a database -->

The service does not manage its own database migrations. It reads from the dapps database which is managed by the marketplace-server.
