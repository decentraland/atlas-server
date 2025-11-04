# AI Agent Context

**Service Purpose:** Provides REST API for querying Decentraland's Genesis City map data (parcels, estates, districts) and generating map visualizations as PNG images. Serves as the data layer for the Decentraland Atlas interface.

**Key Capabilities:**

- Exposes tile data for Genesis City parcels (coordinates, ownership, estate info, names, prices)
- Generates PNG map visualizations with customizable dimensions, tile sizes, centering, and highlighting
- Provides OpenSea-compatible metadata endpoints for parcels, estates, and districts (NFT metadata standard)
- Tracks parcel ownership and contributions via The Graph subgraph integration
- Caches map tiles in S3 for performance optimization
- Supports filtering by coordinates (bounding box queries) and field inclusion/exclusion

**Communication Pattern:** Synchronous HTTP REST API

**Technology Stack:**

- Runtime: Node.js
- Language: TypeScript 4.x
- HTTP Framework: @well-known-components/http-server
- Database: PostgreSQL (via @well-known-components/pg-component)
- Storage: AWS S3 (map tile cache)
- Image Generation: node-canvas (PNG rendering)
- Component Architecture: @well-known-components (logger, metrics, http-server, thegraph-component)

**External Dependencies:**

- Databases: PostgreSQL (tile metadata, ownership data)
- Storage: AWS S3 (cached map tiles and generated images)
- Blockchain Indexing: The Graph Subgraph (marketplace data, parcel ownership, contributions)
- Content: Decentraland transactions (via decentraland-transactions)

**API Specification:** Endpoints documented in README sections above
