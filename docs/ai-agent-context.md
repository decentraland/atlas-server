# AI Agent Context

**Service Purpose:** Provides comprehensive atlas/map APIs for Decentraland Genesis City. Serves tile data, generates map images, provides parcel/estate metadata (OpenSea-compatible), and delivers district information for the Decentraland ecosystem.

**Key Capabilities:**

- Serves all map tiles with comprehensive metadata (ownership, pricing, estate info, rental status)
- Provides both v1 (legacy) and v2 tile formats with field filtering (include/exclude) and coordinate range filtering
- Generates PNG map images with customizable dimensions, zoom level, center point, and highlighted selections
- Delivers parcel and estate metadata using the OpenSea Metadata Standard for marketplace compatibility
- Provides Genesis City districts data with descriptions and parcel lists
- Tracks user contributions to districts
- Integrates rental listing data from the Signatures Server
- Caches generated assets to S3/MinIO with Last-Modified header support
- Supports mini-map and estate-map rendering for embedded views

**Communication Pattern:** Synchronous HTTP REST API (all endpoints public, no authentication required)

**Technology Stack:**

- Runtime: Node.js
- Language: TypeScript
- HTTP Framework: @well-known-components/http-server
- Database: PostgreSQL (read-only access to dapps database for trades)
- Storage: AWS S3 or MinIO (generated map images and tile data)
- Subgraph: The Graph (@well-known-components/thegraph-component)
- Image Generation: node-canvas
- Component Architecture: @well-known-components pattern

**External Dependencies:**

- The Graph Subgraph: Marketplace subgraph for on-chain parcel, estate, and order data
- PostgreSQL: Dapps database (read-only) for trades data
- AWS S3 / MinIO: Object storage for generated map images and cached tile data
- Signatures Server: Rental listings data for LAND parcels and estates
- Features Service: Feature flags for runtime configuration

**Key Concepts:**

- **Tiles**: Map grid units representing LAND parcels. Types: `owned`, `unowned`, `plaza`, `road`, `district`. Include adjacency flags (`top`, `left`, `topLeft`) for rendering optimization.
- **Special Tiles**: Pre-defined tiles for plazas, roads, and districts stored in static JSON data.
- **NFT Metadata**: Parcel and estate data formatted per OpenSea Metadata Standard with attributes, images, and external URLs.
- **Districts**: Genesis City districts with descriptions, parcel lists, and user contribution tracking.
- **Batched Queries**: Uses batched subgraph queries with configurable batch size and concurrency for efficient data fetching.
- **Refresh Cycle**: Periodic data refresh from subgraph with configurable interval (default: 60 seconds).
- **Image Generation**: Uses node-canvas to render map tiles into PNG images with customizable viewport and highlighting.
- **Last-Modified Caching**: All tile and map endpoints support Last-Modified headers for efficient HTTP caching.

**Data Sources:**

- **The Graph Subgraph**: Primary source for parcel ownership, names, estate membership, and active orders
- **Trades Component**: PostgreSQL database for marketplace trades affecting tile prices
- **Rentals Component**: Signatures Server for rental listing data
- **Static Data**: `specialTiles.json` (plazas, roads, districts), `districts.json`, `contributions.json`, `proximity.json`

**API Endpoints:**

| Category      | Endpoint                                                                             | Description                 |
| ------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| Health        | `GET /v2/ping`, `GET /v2/ready`                                                      | Health and readiness checks |
| Tiles         | `GET /v1/tiles` (deprecated), `GET /v2/tiles`, `GET /v2/tiles/info`                  | Tile data                   |
| Maps          | `GET /v1/map.png`, `GET /v2/map.png`, `GET /v1/minimap.png`, `GET /v1/estatemap.png` | Map images                  |
| Parcels       | `GET /v1/parcels/:x/:y/map.png`, `GET /v2/parcels/:x/:y`                             | Parcel maps and metadata    |
| Estates       | `GET /v1/estates/:id/map.png`, `GET /v2/estates/:id`                                 | Estate maps and metadata    |
| Tokens        | `GET /v2/contracts/:address/tokens/:id`                                              | Token metadata by contract  |
| Districts     | `GET /v2/districts`, `GET /v2/districts/:id`                                         | District data               |
| Contributions | `GET /v2/addresses/:address/contributions`                                           | User contributions          |

**Component Architecture:**

The service follows the @well-known-components pattern with these key components:

- `api` / `batchApi`: Subgraph data fetching with batched queries
- `map`: Core map data management with event-driven updates
- `image`: Map image generation using node-canvas
- `district`: District and contribution data from static JSON
- `rentals`: Rental listings integration from Signatures Server
- `trades`: Trades data from PostgreSQL dapps database
- `s3`: S3/MinIO storage for generated assets
- `renderMiniMap` / `renderEstateMiniMap`: Specialized map renderers

**Contract Addresses (Mainnet):**

- LAND: `0xf87e31492faf9a91b02ee0deaad50d51d56d5d4d`
- Estate: `0x959e104e1a4db6317fa58f8295f586e1a978c297`
