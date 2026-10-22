import { RentalListing, RentalStatus } from '@dcl/schemas'
import {
  IConfigComponent,
  ILoggerComponent,
  IMetricsComponent,
} from '@well-known-components/interfaces'
import { ISubgraphComponent } from '@dcl/thegraph-component'
import { convertRentalListingToTileRentalListing } from '../../src/adapters/rentals'
import {
  fromMillisecondsToSeconds,
  fromSecondsToMilliseconds,
} from '../../src/adapters/time'
import { Metrics } from '../../src/metrics'
import { createApiComponent } from '../../src/modules/api/component'
import {
  Cursors,
  EstateFragment,
  IApiComponent,
  NFT,
  OrderFragment,
  ParcelFragment,
  Result,
} from '../../src/modules/api/types'
import { Tile, TileType } from '../../src/modules/map/types'
import { IRentalsComponent } from '../../src/modules/rentals'

const IMAGE_BASE_URL = 'http://base-image-url.com'
const EXTERNAL_BASE_URL = 'http://external-base-url.com'
const LAND_CONTRACT_ADDRESS = '0x1'
const ESTATE_CONTRACT_ADDRESS = '0x2'
const date = Date.now()
const SNAPSHOT_BLOCK = 10
// the snapshot is pinned 5 blocks behind the head
const PINNED_BLOCK = SNAPSHOT_BLOCK - 5
const HEAD_TIMESTAMP = 1234
const headResponse = {
  _meta: { block: { number: SNAPSHOT_BLOCK, timestamp: HEAD_TIMESTAMP } },
}
const SNAPSHOT_TIMESTAMP = fromMillisecondsToSeconds(date) + 10

type SubgraphWorld = {
  parcels?: ParcelFragment[]
  estates?: EstateFragment[]
  estateParcels?: ParcelFragment[]
  // estates only returned when asked for by id
  estatesById?: EstateFragment[]
  timestamp?: number
}

// answers the snapshot and id-paged queries the api makes, like the subgraph would
function mockLandUpdates(world: SubgraphWorld): jest.Mock {
  return jest.fn((query: string) => {
    if (query.includes('_meta')) {
      return Promise.resolve({
        _meta: {
          block: {
            number: SNAPSHOT_BLOCK,
            timestamp: world.timestamp ?? SNAPSHOT_TIMESTAMP,
          },
        },
      })
    }
    const first = Number(/first: (\d+)/.exec(query)![1])
    const lastId = /id_gt: "([^"]*)"/.exec(query)![1]
    const estateIds = /searchParcelEstateId_in: (\[[^\]]*\])/.exec(query)
    const ids = /[{ ,]id_in: (\[[^\]]*\])/.exec(query)
    const items: { id: string }[] = ids
      ? (world.estatesById ?? []).filter((estate) =>
          (JSON.parse(ids[1]) as string[]).includes(estate.id)
        )
      : estateIds
      ? (world.estateParcels ?? []).filter((parcel) =>
          (JSON.parse(estateIds[1]) as string[]).includes(
            parcel.searchParcelEstateId!
          )
        )
      : query.includes('category: estate')
      ? world.estates ?? []
      : world.parcels ?? []
    return Promise.resolve({
      nfts: [...items]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .filter((item) => item.id > lastId)
        .slice(0, first),
    })
  })
}

let apiComponent: IApiComponent
let configComponentMock: IConfigComponent
let rentalsComponentMock: IRentalsComponent
let subgraphComponentMock: ISubgraphComponent
let loggerComponentMock: ILoggerComponent
let metricsComponentMock: IMetricsComponent<keyof Metrics>
let defaultParcel: ParcelFragment
let defaultFstParcelEstate: ParcelFragment
let defaultSndParcelEstate: ParcelFragment
let defaultParcelNFT: NFT
let defaultFstParcelEstateNFT: NFT
let defaultSndParcelEstateNFT: NFT
let defaultParcelTile: Tile
let defaultFstParcelEstateTile: Tile
let defaultSndParcelEstateTile: Tile
let fstEstateNFT: NFT
let loggerErrorMock: jest.Mock
let metricsIncrementMock: jest.Mock

beforeEach(async () => {
  defaultParcel = {
    id: 'parcel-0x0-0',
    name: 'Parcel 0',
    owner: { id: 'anOwnerId' },
    searchParcelX: '0',
    searchParcelY: '1',
    searchParcelEstateId: null,
    tokenId: '0',
    updatedAt: fromMillisecondsToSeconds(date).toString(),
    activeOrder: {
      price: '1000000000000000000',
      expiresAt: (date + 100000000).toString(),
    },
    parcel: {
      data: {
        name: 'Parcel 0',
        description: '',
      },
      estate: null,
    },
  }
  defaultFstParcelEstate = {
    id: 'parcel-0x0-1',
    name: 'Parcel 1',
    owner: { id: 'anOwnerId' },
    searchParcelX: '1',
    searchParcelY: '1',
    tokenId: '1',
    updatedAt: fromMillisecondsToSeconds(date).toString(),
    activeOrder: {
      price: '2000000000000000000',
      expiresAt: (date + 100000000).toString(),
    },
    searchParcelEstateId: 'estate-0x2-1',
    parcel: {
      data: {
        name: 'Parcel 1',
        description: '',
      },
      estate: {
        data: {
          description: '',
        },
        tokenId: '1',
        size: 2,
        nft: {
          name: 'Estate 0',
          owner: {
            id: 'anOwnerId',
          },
          activeOrder: {
            price: '2000000000000000000',
            expiresAt: (date + 100000000).toString(),
          },
          updatedAt: fromMillisecondsToSeconds(date).toString(),
        },
      },
    },
  }
  defaultSndParcelEstate = {
    ...defaultFstParcelEstate,
    id: 'parcel-0x0-2',
    name: 'Parcel 2',
    searchParcelX: '1',
    searchParcelY: '2',
    tokenId: '2',
    parcel: {
      ...defaultFstParcelEstate.parcel,
      data: {
        name: 'Parcel 2',
        description: '',
      },
    },
  }

  defaultParcelNFT = {
    id: '0',
    name: 'Parcel 0',
    description: '',
    image: `${IMAGE_BASE_URL}/parcels/0/1/map.png?size=24&width=1024&height=1024`,
    external_url: `${EXTERNAL_BASE_URL}/contracts/${LAND_CONTRACT_ADDRESS}/tokens/0`,
    attributes: [
      {
        display_type: 'number',
        trait_type: 'X',
        value: 0,
      },
      {
        display_type: 'number',
        trait_type: 'Y',
        value: 1,
      },
    ],
    background_color: '000000',
  }
  defaultFstParcelEstateNFT = {
    id: '1',
    name: 'Parcel 1',
    description: '',
    image: `${IMAGE_BASE_URL}/parcels/1/1/map.png?size=24&width=1024&height=1024`,
    external_url: `${EXTERNAL_BASE_URL}/contracts/${LAND_CONTRACT_ADDRESS}/tokens/1`,
    attributes: [
      {
        display_type: 'number',
        trait_type: 'X',
        value: 1,
      },
      {
        display_type: 'number',
        trait_type: 'Y',
        value: 1,
      },
    ],
    background_color: '000000',
  }
  defaultSndParcelEstateNFT = {
    id: '2',
    name: 'Parcel 2',
    description: '',
    image: `${IMAGE_BASE_URL}/parcels/1/2/map.png?size=24&width=1024&height=1024`,
    external_url: `${EXTERNAL_BASE_URL}/contracts/${LAND_CONTRACT_ADDRESS}/tokens/2`,
    attributes: [
      {
        display_type: 'number',
        trait_type: 'X',
        value: 1,
      },
      {
        display_type: 'number',
        trait_type: 'Y',
        value: 2,
      },
    ],
    background_color: '000000',
  }

  defaultParcelTile = {
    id: '0,1',
    x: Number(defaultParcel.searchParcelX),
    y: Number(defaultParcel.searchParcelY),
    updatedAt: fromSecondsToMilliseconds(Number(defaultParcel.updatedAt)),
    type: TileType.PLAZA,
    top: true,
    left: true,
    topLeft: true,
    name: 'Parcel 0',
    owner: defaultParcel.owner?.id,
    price: 1,
    nftId: defaultParcel.id,
    expiresAt: Math.round(
      parseInt(defaultFstParcelEstate.activeOrder?.expiresAt!, 10) / 1000
    ),
    tokenId: defaultParcel.tokenId,
  }
  defaultFstParcelEstateTile = {
    id: '1,1',
    x: Number(defaultFstParcelEstate.searchParcelX),
    y: Number(defaultFstParcelEstate.searchParcelY),
    updatedAt: fromSecondsToMilliseconds(
      Number(defaultFstParcelEstate.updatedAt)
    ),
    type: TileType.PLAZA,
    top: true,
    left: true,
    topLeft: true,
    name: 'Estate 0',
    estateId: '1',
    nftId: defaultFstParcelEstate.id,
    owner: defaultFstParcelEstate.owner?.id,
    price: 2,
    expiresAt: Math.round(
      parseInt(defaultFstParcelEstate.activeOrder?.expiresAt!, 10) / 1000
    ),
    tokenId: defaultFstParcelEstate.tokenId,
  }
  defaultSndParcelEstateTile = {
    id: '1,2',
    x: Number(defaultSndParcelEstate.searchParcelX),
    y: Number(defaultSndParcelEstate.searchParcelY),
    updatedAt: fromSecondsToMilliseconds(
      Number(defaultSndParcelEstate.updatedAt)
    ),
    type: TileType.PLAZA,
    top: true,
    left: true,
    topLeft: true,
    name: 'Estate 0',
    estateId: '1',
    nftId: defaultSndParcelEstate.id,
    owner: defaultSndParcelEstate.owner?.id,
    price: 2,
    expiresAt: Math.round(
      parseInt(defaultSndParcelEstate.activeOrder?.expiresAt!, 10) / 1000
    ),
    tokenId: defaultSndParcelEstate.tokenId,
  }

  fstEstateNFT = {
    id: '1',
    name: 'Estate 0',
    description: '',
    image: `${IMAGE_BASE_URL}/estates/1/map.png?size=24&width=1024&height=1024`,
    external_url: `${EXTERNAL_BASE_URL}/contracts/${ESTATE_CONTRACT_ADDRESS}/tokens/1`,
    attributes: [{ display_type: 'number', trait_type: 'Size', value: 2 }],
    background_color: '000000',
  }

  configComponentMock = {
    getNumber: jest.fn(),
    getString: jest.fn(),
    requireNumber: jest.fn().mockImplementation((key) => {
      switch (key) {
        case 'API_BATCH_SIZE':
          return 1
        case 'API_CONCURRENCY':
          return 1
        default:
          return undefined
      }
    }),
    requireString: jest.fn().mockImplementation((key) => {
      switch (key) {
        case 'IMAGE_BASE_URL':
          return IMAGE_BASE_URL
        case 'EXTERNAL_BASE_URL':
          return EXTERNAL_BASE_URL
        case 'LAND_CONTRACT_ADDRESS':
          return LAND_CONTRACT_ADDRESS
        case 'ESTATE_CONTRACT_ADDRESS':
          return ESTATE_CONTRACT_ADDRESS
        default:
          return undefined
      }
    }),
  }
  rentalsComponentMock = {
    getOpenRentalListings: jest.fn(),
    getOpenRentalListingsOfNfts: jest.fn().mockResolvedValue([]),
    getUpdatedRentalListings: jest.fn(),
  }
  subgraphComponentMock = {
    query: jest.fn(),
  }
  loggerErrorMock = jest.fn()
  metricsIncrementMock = jest.fn()
  loggerComponentMock = {
    getLogger: () => ({
      info: () => undefined,
      error: loggerErrorMock,
      warn: () => undefined,
      log: () => undefined,
      debug: () => undefined,
    }),
  }
  metricsComponentMock = {
    increment: metricsIncrementMock,
    decrement: () => undefined,
    startTimer: () => ({ end: () => undefined }),
    observe: () => undefined,
    getValue: () =>
      Promise.resolve({
        help: '',
        name: '',
        type: IMetricsComponent.CounterType,
        values: [],
        aggregator: '',
      }),
    resetAll: () => undefined,
    reset: () => undefined,
  }
  apiComponent = await createApiComponent({
    config: configComponentMock,
    rentals: rentalsComponentMock,
    subgraph: subgraphComponentMock,
    logger: loggerComponentMock,
    metrics: metricsComponentMock,
  })
})

describe('when fetching data', () => {
  describe('and fetching the graph fails', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest
        .fn()
        .mockRejectedValueOnce(new Error('An error ocurred'))
    })

    it('should throw an error', () => {
      return expect(apiComponent.fetchData()).rejects.toThrowError(
        'An error ocurred'
      )
    })
  })

  describe('and fetching the open rental listings fails', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({})
      rentalsComponentMock.getOpenRentalListings = jest
        .fn()
        .mockRejectedValueOnce(new Error('An error ocurred'))
    })

    it('should throw an error', () => {
      return expect(apiComponent.fetchData()).rejects.toThrowError(
        'An error ocurred'
      )
    })
  })

  describe('and the subgraph does not report the timestamp of its head block', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest.fn().mockResolvedValueOnce({
        _meta: { block: { number: 10, timestamp: null } },
      })
    })

    it('should fail with an error naming the block', () => {
      return expect(apiComponent.fetchData()).rejects.toThrowError(
        'The subgraph did not report the timestamp of block 10'
      )
    })
  })

  describe('and the nfts changed after the head block read before fetching them', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest
        .fn()
        .mockResolvedValueOnce(headResponse)
        .mockResolvedValueOnce({
          nfts: [
            { ...defaultParcel, updatedAt: (HEAD_TIMESTAMP + 90).toString() },
          ],
        })
        .mockResolvedValueOnce({ nfts: [] })
      rentalsComponentMock.getOpenRentalListings = jest
        .fn()
        .mockResolvedValue([])
    })

    it("should resume the land updates from the head block's timestamp", async () => {
      const result = await apiComponent.fetchData()
      expect(result.cursors.land).toBe(HEAD_TIMESTAMP)
    })
  })

  describe("and there's a single batch of nfts", () => {
    let nftFragments: ParcelFragment[]

    beforeEach(() => {
      nftFragments = [
        defaultParcel,
        defaultFstParcelEstate,
        defaultSndParcelEstate,
      ]
      subgraphComponentMock.query = jest
        .fn()
        .mockResolvedValueOnce(headResponse)
        .mockResolvedValueOnce({ nfts: nftFragments })
        .mockResolvedValueOnce({ nfts: [] })
      rentalsComponentMock.getOpenRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it("should read the batches at the snapshot's block", async () => {
      await apiComponent.fetchData()
      expect(
        (subgraphComponentMock.query as jest.Mock).mock.calls[1][0]
      ).toContain(`block: { number: ${PINNED_BLOCK} }`)
    })

    it('should return the tiles, the parcels and the estates', () => {
      return expect(apiComponent.fetchData()).resolves.toEqual({
        tiles: [
          defaultParcelTile,
          defaultFstParcelEstateTile,
          defaultSndParcelEstateTile,
        ],
        parcels: [
          defaultParcelNFT,
          defaultFstParcelEstateNFT,
          defaultSndParcelEstateNFT,
        ],
        estates: [fstEstateNFT],
        updatedAt: fromSecondsToMilliseconds(Number(defaultParcel.updatedAt)),
        cursors: { land: HEAD_TIMESTAMP, rentals: expect.any(Number) },
      })
    })
  })

  describe("and there's more than one batch of nfts", () => {
    let nftFragments: ParcelFragment[]
    let fourthParcel: ParcelFragment
    let fifthParcelEstate: ParcelFragment
    let sixthParcelEstate: ParcelFragment
    let fourthParcelRentalListing: RentalListing
    let fifthParcelEstateRentalListing: RentalListing
    let maxDateInSeconds: number

    beforeEach(() => {
      maxDateInSeconds = fromMillisecondsToSeconds(date) + 5
      fourthParcel = {
        ...defaultParcel,
        id: 'parcel-0x0-3',
        name: 'Parcel 3',
        searchParcelX: '3',
        searchParcelY: '3',
        searchParcelEstateId: null,
        tokenId: '3',
        activeOrder: null,
        updatedAt: maxDateInSeconds.toString(),
        parcel: {
          ...defaultParcel.parcel,
          data: {
            ...defaultParcel.parcel.data,
            name: 'Parcel 3',
            description: '',
          },
        },
      }
      fifthParcelEstate = {
        ...defaultFstParcelEstate,
        id: 'parcel-0x0-4',
        name: 'Parcel 4',
        searchParcelX: '4',
        searchParcelY: '3',
        searchParcelEstateId: 'estate-0x2-2',
        tokenId: '4',
        updatedAt: (maxDateInSeconds - 1).toString(),
        parcel: {
          data: {
            name: 'Parcel 4',
            description: '',
          },
          estate: {
            ...defaultFstParcelEstate.parcel.estate!,
            tokenId: '2',
            size: 2,
            nft: {
              ...defaultFstParcelEstate.parcel.estate?.nft!,
              name: 'Estate 1',
              owner: {
                id: 'anOwnerId',
              },
            },
          },
        },
      }
      sixthParcelEstate = {
        ...fifthParcelEstate,
        id: 'parcel-0x0-5',
        tokenId: '5',
        name: 'Parcel 5',
        searchParcelX: '5',
        searchParcelY: '3',
        updatedAt: (maxDateInSeconds - 2).toString(),
        parcel: {
          ...fifthParcelEstate.parcel,
          data: {
            name: 'Parcel 5',
            description: '',
          },
        },
      }
      nftFragments = [
        defaultParcel,
        defaultFstParcelEstate,
        defaultSndParcelEstate,
        fourthParcel,
        fifthParcelEstate,
        sixthParcelEstate,
      ]

      fourthParcelRentalListing = {
        id: 'fourthParcelRentalId',
        status: RentalStatus.OPEN,
        nftId: fourthParcel.id,
        expiration: date + 100000000,
        createdAt: date,
        updatedAt: date,
        periods: [{ minDays: 1, maxDays: 1, pricePerDay: '10000000' }],
      } as RentalListing
      fifthParcelEstateRentalListing = {
        ...fourthParcelRentalListing,
        id: 'estateRental',
        nftId: fifthParcelEstate.searchParcelEstateId!,
        periods: [{ minDays: 2, maxDays: 2, pricePerDay: '20000000' }],
      } as RentalListing

      subgraphComponentMock.query = jest
        .fn()
        .mockResolvedValueOnce(headResponse)
        .mockResolvedValueOnce({ nfts: nftFragments.splice(0, 3) })
        .mockResolvedValueOnce({ nfts: nftFragments.splice(0, 6) })
        .mockResolvedValueOnce({ nfts: [] })
      rentalsComponentMock.getOpenRentalListings = jest
        .fn()
        .mockResolvedValueOnce([
          fourthParcelRentalListing,
          fifthParcelEstateRentalListing,
          { ...fourthParcelRentalListing, nftId: 'parcel-0x0-404' },
        ])
    })

    it('should return the tiles, the parcels and the estates with their rental listings', () => {
      return expect(apiComponent.fetchData()).resolves.toEqual({
        tiles: [
          {
            id: '0,1',
            x: Number(defaultParcel.searchParcelX),
            y: Number(defaultParcel.searchParcelY),
            updatedAt: fromSecondsToMilliseconds(
              Number(defaultParcel.updatedAt)
            ),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Parcel 0',
            owner: defaultParcel.owner?.id,
            price: 1,
            nftId: defaultParcel.id,
            expiresAt: Math.round(
              parseInt(defaultFstParcelEstate.activeOrder?.expiresAt!, 10) /
                1000
            ),
            tokenId: defaultParcel.tokenId,
          },
          {
            id: '1,1',
            x: Number(defaultFstParcelEstate.searchParcelX),
            y: Number(defaultFstParcelEstate.searchParcelY),
            updatedAt: fromSecondsToMilliseconds(
              Number(defaultFstParcelEstate.updatedAt)
            ),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Estate 0',
            estateId: '1',
            nftId: defaultFstParcelEstate.id,
            owner: defaultFstParcelEstate.owner?.id,
            price: 2,
            expiresAt: Math.round(
              parseInt(defaultFstParcelEstate.activeOrder?.expiresAt!, 10) /
                1000
            ),
            tokenId: defaultFstParcelEstate.tokenId,
          },
          {
            id: '1,2',
            x: Number(defaultSndParcelEstate.searchParcelX),
            y: Number(defaultSndParcelEstate.searchParcelY),
            updatedAt: fromSecondsToMilliseconds(
              Number(defaultSndParcelEstate.updatedAt)
            ),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Estate 0',
            estateId: '1',
            nftId: defaultSndParcelEstate.id,
            owner: defaultSndParcelEstate.owner?.id,
            price: 2,
            expiresAt: Math.round(
              parseInt(defaultSndParcelEstate.activeOrder?.expiresAt!, 10) /
                1000
            ),
            tokenId: defaultSndParcelEstate.tokenId,
          },
          {
            id: '3,3',
            x: Number(fourthParcel.searchParcelX),
            y: Number(fourthParcel.searchParcelY),
            updatedAt: fromSecondsToMilliseconds(
              Number(fourthParcel.updatedAt)
            ),
            type: 'plaza',
            top: true,
            left: true,
            nftId: fourthParcel.id,
            topLeft: true,
            name: 'Parcel 3',
            owner: fourthParcel.owner?.id,
            tokenId: fourthParcel.tokenId,
            rentalListing: convertRentalListingToTileRentalListing(
              fourthParcelRentalListing
            ),
          },
          {
            id: '4,3',
            x: Number(fifthParcelEstate.searchParcelX),
            y: Number(fifthParcelEstate.searchParcelY),
            updatedAt: fromSecondsToMilliseconds(
              Number(fifthParcelEstate.updatedAt)
            ),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Estate 1',
            estateId: '2',
            nftId: fifthParcelEstate.id,
            owner: fifthParcelEstate.owner?.id,
            price: 2,
            expiresAt: Math.round(
              parseInt(fifthParcelEstate.activeOrder?.expiresAt!, 10) / 1000
            ),
            tokenId: fifthParcelEstate.tokenId,
            rentalListing: convertRentalListingToTileRentalListing(
              fifthParcelEstateRentalListing
            ),
          },
          {
            id: '5,3',
            x: Number(sixthParcelEstate.searchParcelX),
            y: Number(sixthParcelEstate.searchParcelY),
            updatedAt: fromSecondsToMilliseconds(
              Number(sixthParcelEstate.updatedAt)
            ),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Estate 1',
            estateId: '2',
            nftId: sixthParcelEstate.id,
            owner: sixthParcelEstate.owner?.id,
            price: 2,
            expiresAt: Math.round(
              parseInt(sixthParcelEstate.activeOrder?.expiresAt!, 10) / 1000
            ),
            tokenId: sixthParcelEstate.tokenId,
            rentalListing: convertRentalListingToTileRentalListing(
              fifthParcelEstateRentalListing
            ),
          },
        ],
        parcels: [
          {
            id: '0',
            name: 'Parcel 0',
            description: '',
            image: `${IMAGE_BASE_URL}/parcels/0/1/map.png?size=24&width=1024&height=1024`,
            external_url: `${EXTERNAL_BASE_URL}/contracts/${LAND_CONTRACT_ADDRESS}/tokens/0`,
            attributes: [
              {
                display_type: 'number',
                trait_type: 'X',
                value: 0,
              },
              {
                display_type: 'number',
                trait_type: 'Y',
                value: 1,
              },
            ],
            background_color: '000000',
          },
          {
            id: '1',
            name: 'Parcel 1',
            description: '',
            image: `${IMAGE_BASE_URL}/parcels/1/1/map.png?size=24&width=1024&height=1024`,
            external_url: `${EXTERNAL_BASE_URL}/contracts/${LAND_CONTRACT_ADDRESS}/tokens/1`,
            attributes: [
              {
                display_type: 'number',
                trait_type: 'X',
                value: 1,
              },
              {
                display_type: 'number',
                trait_type: 'Y',
                value: 1,
              },
            ],
            background_color: '000000',
          },
          {
            id: '2',
            name: 'Parcel 2',
            description: '',
            image: `${IMAGE_BASE_URL}/parcels/1/2/map.png?size=24&width=1024&height=1024`,
            external_url: `${EXTERNAL_BASE_URL}/contracts/${LAND_CONTRACT_ADDRESS}/tokens/2`,
            attributes: [
              {
                display_type: 'number',
                trait_type: 'X',
                value: 1,
              },
              {
                display_type: 'number',
                trait_type: 'Y',
                value: 2,
              },
            ],
            background_color: '000000',
          },
          {
            id: '3',
            name: 'Parcel 3',
            description: '',
            image: `${IMAGE_BASE_URL}/parcels/3/3/map.png?size=24&width=1024&height=1024`,
            external_url: `${EXTERNAL_BASE_URL}/contracts/${LAND_CONTRACT_ADDRESS}/tokens/3`,
            attributes: [
              {
                display_type: 'number',
                trait_type: 'X',
                value: 3,
              },
              {
                display_type: 'number',
                trait_type: 'Y',
                value: 3,
              },
            ],
            background_color: '000000',
          },
          {
            id: '4',
            name: 'Parcel 4',
            description: '',
            image: `${IMAGE_BASE_URL}/parcels/4/3/map.png?size=24&width=1024&height=1024`,
            external_url: `${EXTERNAL_BASE_URL}/contracts/${LAND_CONTRACT_ADDRESS}/tokens/4`,
            attributes: [
              {
                display_type: 'number',
                trait_type: 'X',
                value: 4,
              },
              {
                display_type: 'number',
                trait_type: 'Y',
                value: 3,
              },
            ],
            background_color: '000000',
          },
          {
            id: '5',
            name: 'Parcel 5',
            description: '',
            image: `${IMAGE_BASE_URL}/parcels/5/3/map.png?size=24&width=1024&height=1024`,
            external_url: `${EXTERNAL_BASE_URL}/contracts/${LAND_CONTRACT_ADDRESS}/tokens/5`,
            attributes: [
              {
                display_type: 'number',
                trait_type: 'X',
                value: 5,
              },
              {
                display_type: 'number',
                trait_type: 'Y',
                value: 3,
              },
            ],
            background_color: '000000',
          },
        ],
        estates: [
          {
            id: '1',
            name: 'Estate 0',
            description: '',
            image: `${IMAGE_BASE_URL}/estates/1/map.png?size=24&width=1024&height=1024`,
            external_url: `${EXTERNAL_BASE_URL}/contracts/${ESTATE_CONTRACT_ADDRESS}/tokens/1`,
            attributes: [
              { display_type: 'number', trait_type: 'Size', value: 2 },
            ],
            background_color: '000000',
          },
          {
            id: '2',
            name: 'Estate 1',
            description: '',
            image: `${IMAGE_BASE_URL}/estates/2/map.png?size=24&width=1024&height=1024`,
            external_url: `${EXTERNAL_BASE_URL}/contracts/${ESTATE_CONTRACT_ADDRESS}/tokens/2`,
            attributes: [
              { display_type: 'number', trait_type: 'Size', value: 2 },
            ],
            background_color: '000000',
          },
        ],
        updatedAt: fromSecondsToMilliseconds(maxDateInSeconds),
        cursors: { land: HEAD_TIMESTAMP, rentals: expect.any(Number) },
      })
    })
  })
})

describe('when fetching update data', () => {
  let cursors: Cursors
  let fstEstate: EstateFragment
  let fstParcel: ParcelFragment
  let fstParcelTile: Tile
  let defaultParcelRentalListing: RentalListing
  let fstEstateRentalListing: RentalListing
  let maxDateInSeconds: number

  beforeEach(() => {
    cursors = { land: 100, rentals: 100000 }
    maxDateInSeconds = fromMillisecondsToSeconds(date)
    fstParcel = {
      ...defaultParcel,
      updatedAt: (maxDateInSeconds - 1).toString(),
    }
    fstEstate = {
      id: 'estate-0x2-1',
      tokenId: '1',
      name: 'Estate 0',
      updatedAt: maxDateInSeconds.toString(),
      estate: {
        size: 2,
        data: { description: '' },
      },
    }
    fstParcelTile = {
      ...defaultParcelTile,
      updatedAt: fromSecondsToMilliseconds(maxDateInSeconds - 1),
    }
    defaultParcelRentalListing = {
      id: 'defaultParcelRentalId',
      status: RentalStatus.OPEN,
      nftId: defaultParcel.id,
      expiration: date,
      createdAt: date,
      updatedAt: date,
      periods: [{ minDays: 1, maxDays: 1, pricePerDay: '10000000' }],
    } as RentalListing
    fstEstateRentalListing = {
      id: 'fstEstateRentalId',
      status: RentalStatus.OPEN,
      nftId: defaultFstParcelEstate.searchParcelEstateId!,
      expiration: date,
      createdAt: date,
      updatedAt: date,
      periods: [{ minDays: 2, maxDays: 2, pricePerDay: '20000000' }],
    } as RentalListing
  })

  describe("and fetching the graph fails but the rental listings fetch doesn't", () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest
        .fn()
        .mockRejectedValueOnce(new Error('An error ocurred'))
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([defaultParcelRentalListing])
    })

    it('should fail the update so no partial data is applied', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {
          [defaultParcelTile.id]: defaultParcelTile,
        })
      ).rejects.toThrowError('Failed to fetch update data: An error ocurred')
    })

    it('should log the error and count the land failure', async () => {
      await apiComponent.fetchUpdatedData(cursors, {}).catch(() => undefined)
      expect({
        logged: loggerErrorMock.mock.calls,
        counted: metricsIncrementMock.mock.calls,
      }).toEqual({
        logged: [
          [
            'Failed to retrieve updated information about the lands: Error: An error ocurred',
          ],
        ],
        counted: [['dcl_map_update', { type: 'land', status: 'failure' }]],
      })
    })
  })

  describe("and fetching the rental listings fails but the graph fetch doesn't", () => {
    let updatedParcel: ParcelFragment

    beforeEach(() => {
      updatedParcel = {
        ...defaultParcel,
        updatedAt: (cursors.land + 5).toString(),
      }
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [updatedParcel],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockRejectedValueOnce(new Error('An error ocurred'))
    })

    it('should advance the land cursor and keep the rentals cursor', async () => {
      const result = await apiComponent.fetchUpdatedData(cursors, {})
      expect(result.cursors).toEqual({
        land: SNAPSHOT_TIMESTAMP,
        rentals: cursors.rentals,
      })
    })

    it('should keep the rental listing the tile already had', async () => {
      const result = await apiComponent.fetchUpdatedData(cursors, {
        [defaultParcelTile.id]: {
          ...defaultParcelTile,
          rentalListing: convertRentalListingToTileRentalListing(
            defaultParcelRentalListing
          ),
        },
      })
      expect(result.tiles[0].rentalListing).toEqual(
        convertRentalListingToTileRentalListing(defaultParcelRentalListing)
      )
    })

    it('should log the error and count the rentals failure', async () => {
      await apiComponent.fetchUpdatedData(cursors, {})
      expect({
        logged: loggerErrorMock.mock.calls,
        counted: metricsIncrementMock.mock.calls,
      }).toEqual({
        logged: [
          [
            'Failed to retrieve updated information about the rental listings: Error: An error ocurred',
          ],
        ],
        counted: [
          ['dcl_map_update', { type: 'land', status: 'success' }],
          ['dcl_map_update', { type: 'rental', status: 'failure' }],
        ],
      })
    })
  })

  describe('and both the graph and the rental listings fetch fail', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest
        .fn()
        .mockRejectedValueOnce(new Error('An error ocurred'))
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockRejectedValueOnce(new Error('An error ocurred'))
    })

    it('should fail the update', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {})
      ).rejects.toThrowError('Failed to fetch update data: An error ocurred')
    })
  })

  describe('and there are no parcels, estates or rental listings updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it("should return no assets, move the land cursor to the snapshot block's timestamp and keep the rentals cursor", () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {})
      ).resolves.toEqual({
        tiles: [],
        parcels: [],
        estates: [],
        updatedAt: fromSecondsToMilliseconds(SNAPSHOT_TIMESTAMP),
        cursors: { land: SNAPSHOT_TIMESTAMP, rentals: cursors.rentals },
      })
    })
  })

  describe('and there are only parcels to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [defaultParcel],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should return a batched list of tiles and parcels to update', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {})
      ).resolves.toEqual({
        tiles: [defaultParcelTile],
        parcels: [defaultParcelNFT],
        estates: [],
        updatedAt: fromSecondsToMilliseconds(SNAPSHOT_TIMESTAMP),
        cursors: { land: SNAPSHOT_TIMESTAMP, rentals: cursors.rentals },
      })
    })
  })

  describe('and there are only estates to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [],
        estates: [fstEstate],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should return a batched list of tiles and estates to update', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {})
      ).resolves.toEqual({
        tiles: [defaultFstParcelEstateTile, defaultSndParcelEstateTile],
        parcels: [defaultFstParcelEstateNFT, defaultSndParcelEstateNFT],
        estates: [fstEstateNFT],
        updatedAt: fromSecondsToMilliseconds(SNAPSHOT_TIMESTAMP),
        cursors: { land: SNAPSHOT_TIMESTAMP, rentals: cursors.rentals },
      })
    })
  })

  describe('and an updated estate was dissolved', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estates: [
          {
            ...fstEstate,
            name: 'Old estate',
            estate: { size: 0, data: { description: 'Gone' } },
          },
        ],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should return the estate with its dissolved representation', async () => {
      const result = await apiComponent.fetchUpdatedData(cursors, {})
      expect(result.estates).toEqual([
        {
          id: '1',
          name: 'Old estate',
          description: 'Gone',
          image: `${IMAGE_BASE_URL}/estates/1/map.png?size=24&width=1024&height=1024`,
          external_url: `${EXTERNAL_BASE_URL}/contracts/${ESTATE_CONTRACT_ADDRESS}/tokens/1`,
          attributes: [
            { display_type: 'number', trait_type: 'Size', value: 0 },
          ],
          background_color: '000000',
        },
      ])
    })
  })

  describe('and there are parcels and estates to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [fstParcel],
        estates: [fstEstate],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should return a batched list of tiles, parcels and estates to update', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {})
      ).resolves.toEqual({
        tiles: [
          fstParcelTile,
          defaultFstParcelEstateTile,
          defaultSndParcelEstateTile,
        ],
        parcels: [
          defaultParcelNFT,
          defaultFstParcelEstateNFT,
          defaultSndParcelEstateNFT,
        ],
        estates: [fstEstateNFT],
        updatedAt: fromSecondsToMilliseconds(SNAPSHOT_TIMESTAMP),
        cursors: { land: SNAPSHOT_TIMESTAMP, rentals: cursors.rentals },
      })
    })
  })

  describe('and there are only listings that belong to a parcel to be be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([defaultParcelRentalListing])
    })

    it('should return a batched list of tiles to update with their rental listings updated', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {
          [defaultParcelTile.id]: defaultParcelTile,
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultParcelTile,
            updatedAt: defaultParcelRentalListing.updatedAt,
            rentalListing: convertRentalListingToTileRentalListing(
              defaultParcelRentalListing
            ),
          },
        ],
        parcels: [],
        estates: [],
        updatedAt: expect.any(Number),
        cursors: expect.any(Object),
      })
    })
  })

  describe('and there are only listings that belong to an estate to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([fstEstateRentalListing])
    })

    it('should return a batched list of tiles to update with their rental listings updated', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {
          [defaultFstParcelEstate.id]: defaultFstParcelEstateTile,
          [defaultSndParcelEstate.id]: defaultSndParcelEstateTile,
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultFstParcelEstateTile,
            updatedAt: fstEstateRentalListing.updatedAt,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
          {
            ...defaultSndParcelEstateTile,
            updatedAt: fstEstateRentalListing.updatedAt,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
        ],
        parcels: [],
        estates: [],
        updatedAt: expect.any(Number),
        cursors: expect.any(Object),
      })
    })
  })

  describe('and there are only listing that belong to estates and parcels to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([
          defaultParcelRentalListing,
          fstEstateRentalListing,
        ])
    })

    it('should return a batched list of tiles to update with their rental listings updated', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {
          [defaultParcelTile.id]: defaultParcelTile,
          [defaultFstParcelEstate.id]: defaultFstParcelEstateTile,
          [defaultSndParcelEstate.id]: defaultSndParcelEstateTile,
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultParcelTile,
            updatedAt: defaultParcelRentalListing.updatedAt,
            rentalListing: convertRentalListingToTileRentalListing(
              defaultParcelRentalListing
            ),
          },
          {
            ...defaultFstParcelEstateTile,
            updatedAt: defaultParcelRentalListing.updatedAt,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
          {
            ...defaultSndParcelEstateTile,
            updatedAt: defaultParcelRentalListing.updatedAt,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
        ],
        parcels: [],
        estates: [],
        updatedAt: expect.any(Number),
        cursors: expect.any(Object),
      })
    })
  })

  describe('and there are only rental listings that belong to parcels that are not open anymore', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([
          { ...defaultParcelRentalListing, status: RentalStatus.CANCELLED },
        ])
    })

    it("should return a batched list of tiles to update with their rental listings removed when the rental listing wasn't open", () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {
          [defaultParcelTile.id]: {
            ...defaultParcelTile,
            rentalListing: defaultParcelRentalListing,
          },
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultParcelTile,
            updatedAt: defaultParcelRentalListing.updatedAt,
            rentalListing: undefined,
          },
        ],
        parcels: [],
        estates: [],
        updatedAt: expect.any(Number),
        cursors: expect.any(Object),
      })
    })
  })

  describe('and there are only rental listings that belong to estates that are not open anymore', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([
          { ...fstEstateRentalListing, status: RentalStatus.CANCELLED },
        ])
    })

    it("should return a batched list of tiles to update with their rental listings removed when the rental listing wasn't open", () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {
          [defaultFstParcelEstateTile.id]: {
            ...defaultFstParcelEstateTile,
            rentalListing: fstEstateRentalListing,
          },
          [defaultSndParcelEstateTile.id]: {
            ...defaultSndParcelEstateTile,
            rentalListing: fstEstateRentalListing,
          },
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultFstParcelEstateTile,
            updatedAt: fstEstateRentalListing.updatedAt,
          },
          {
            ...defaultSndParcelEstateTile,
            updatedAt: fstEstateRentalListing.updatedAt,
          },
        ],
        parcels: [],
        estates: [],
        updatedAt: expect.any(Number),
        cursors: expect.any(Object),
      })
    })
  })

  describe('and there are parcels and rental listings associated to those parcels to be updated', () => {
    let updatedDefaultParcel: ParcelFragment
    let updatedDefaultParcelTile: Tile
    let updatedDefaultParcelNFT: NFT

    beforeEach(() => {
      updatedDefaultParcel = {
        ...defaultParcel,
        name: 'Another name',
        parcel: {
          ...defaultParcel.parcel,
          data: {
            ...defaultParcel.parcel.data!,
            name: 'Another name',
          },
        },
      }
      updatedDefaultParcelTile = {
        ...defaultParcelTile,
        name: updatedDefaultParcel.name!,
        rentalListing: convertRentalListingToTileRentalListing(
          defaultParcelRentalListing
        ),
      }
      updatedDefaultParcelNFT = {
        ...defaultParcelNFT,
        name: updatedDefaultParcel.name!,
      }

      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [updatedDefaultParcel],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([defaultParcelRentalListing])
    })

    it('should return a batched list of tiles to update with their rental listings updated', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {
          [defaultParcelTile.id]: defaultParcelTile,
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...updatedDefaultParcelTile,
            updatedAt: defaultParcelRentalListing.updatedAt,
          },
        ],
        parcels: [updatedDefaultParcelNFT],
        estates: [],
        updatedAt: expect.any(Number),
        cursors: expect.any(Object),
      })
    })
  })

  describe('and there is a parcel that is added to an estate and a rental listing is created for that state', () => {
    let updatedFstEstate: EstateFragment
    let updatedDefaultParcelIntoFstEstate: ParcelFragment
    let updatedDefaultParcelTileIntoFstEstate: Tile

    beforeEach(() => {
      updatedDefaultParcelIntoFstEstate = {
        ...defaultParcel,
        searchParcelEstateId: defaultFstParcelEstate.searchParcelEstateId,
        parcel: {
          ...defaultParcel.parcel,
          estate: defaultFstParcelEstate.parcel.estate,
        },
      }
      updatedDefaultParcelTileIntoFstEstate = {
        ...defaultParcelTile,
        estateId: fstEstateNFT.id,
        name: defaultFstParcelEstateTile.name,
        price: defaultFstParcelEstateTile.price,
      }

      updatedFstEstate = {
        ...fstEstate,
        estate: { ...fstEstate.estate, size: 3 },
      }
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [
          updatedDefaultParcelIntoFstEstate,
          defaultFstParcelEstate,
          defaultSndParcelEstate,
        ],
        parcels: [updatedDefaultParcelIntoFstEstate],
        estates: [updatedFstEstate],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([fstEstateRentalListing])
    })

    it('should return a batched list of tiles, parcels and estates to update with their rental listings updated', () => {
      return expect(
        apiComponent.fetchUpdatedData(cursors, {
          [defaultParcel.id]: defaultParcelTile,
          [defaultFstParcelEstate.id]: defaultFstParcelEstateTile,
          [defaultSndParcelEstate.id]: defaultSndParcelEstateTile,
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultFstParcelEstateTile,
            updatedAt: fstEstateRentalListing.updatedAt,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
          {
            ...defaultSndParcelEstateTile,
            updatedAt: fstEstateRentalListing.updatedAt,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
          {
            ...updatedDefaultParcelTileIntoFstEstate,
            updatedAt: fstEstateRentalListing.updatedAt,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
        ],
        // Should it update the parcels?
        parcels: [
          defaultParcelNFT,
          defaultFstParcelEstateNFT,
          defaultSndParcelEstateNFT,
        ],
        estates: [fstEstateNFT],
        updatedAt: expect.any(Number),
        cursors: expect.any(Object),
      })
    })
  })

  describe('and an estate got a new order and a rental listing in the same pass', () => {
    let result: Result
    let estateWithOrder: EstateFragment
    let newOrder: OrderFragment

    beforeEach(async () => {
      newOrder = {
        price: '7000000000000000000',
        expiresAt: `${date + 100000000}`,
      }
      const withNewOrder = (parcel: ParcelFragment): ParcelFragment => ({
        ...parcel,
        parcel: {
          ...parcel.parcel,
          estate: {
            ...parcel.parcel.estate!,
            nft: { ...parcel.parcel.estate!.nft, activeOrder: newOrder },
          },
        },
      })
      estateWithOrder = { ...fstEstate, updatedAt: `${maxDateInSeconds + 5}` }
      subgraphComponentMock.query = mockLandUpdates({
        estates: [estateWithOrder],
        estateParcels: [
          withNewOrder(defaultFstParcelEstate),
          withNewOrder(defaultSndParcelEstate),
        ],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([fstEstateRentalListing])
      result = await apiComponent.fetchUpdatedData(cursors, {
        [defaultFstParcelEstateTile.id]: defaultFstParcelEstateTile,
        [defaultSndParcelEstateTile.id]: defaultSndParcelEstateTile,
      })
    })

    it('should show both the new order and the rental listing on its tiles', () => {
      expect(
        result.tiles.map((tile) => [tile.price, tile.rentalListing])
      ).toEqual([
        [7, convertRentalListingToTileRentalListing(fstEstateRentalListing)],
        [7, convertRentalListingToTileRentalListing(fstEstateRentalListing)],
      ])
    })
  })

  describe('and a rental listing belongs to an estate with thousands of tiles', () => {
    let oldTiles: Record<string, Tile>
    let startedAt: number
    let elapsed: number
    let tilesCount: number

    beforeEach(async () => {
      oldTiles = {}
      for (let i = 0; i < 20000; i++) {
        const tile = {
          ...defaultFstParcelEstateTile,
          id: `${i % 150},${Math.floor(i / 150)}`,
          nftId: `parcel-0x0-${i}`,
        }
        oldTiles[tile.id] = tile
      }
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([fstEstateRentalListing])
      startedAt = Date.now()
      tilesCount = (await apiComponent.fetchUpdatedData(cursors, oldTiles))
        .tiles.length
      elapsed = Date.now() - startedAt
    })

    it('should update all its tiles in linear time', () => {
      expect({ tilesCount, fast: elapsed < 1000 }).toEqual({
        tilesCount: 20000,
        fast: true,
      })
    })
  })

  describe('and an updated parcel has an order with its creation time', () => {
    beforeEach(() => {
      subgraphComponentMock.query = mockLandUpdates({
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        parcels: [
          {
            ...defaultParcel,
            activeOrder: {
              ...defaultParcel.activeOrder!,
              createdAt: '1700000000',
            },
          },
        ],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should keep the order creation time in milliseconds on the tile', async () => {
      const result = await apiComponent.fetchUpdatedData(cursors, {})
      expect(result.tiles[0].orderCreatedAt).toBe(1700000000000)
    })
  })

  describe('and an updated estate has more parcels than fit in a page', () => {
    let estateParcels: ParcelFragment[]
    let result: Result

    beforeEach(async () => {
      estateParcels = Array.from({ length: 150 }, (_, i) => ({
        ...defaultFstParcelEstate,
        id: `parcel-0x0-big-${String(i).padStart(3, '0')}`,
        tokenId: `big-${i}`,
        searchParcelX: i === 149 ? '18' : '1000',
        searchParcelY: i === 149 ? '-139' : `${i}`,
      }))
      subgraphComponentMock.query = mockLandUpdates({
        estates: [fstEstate],
        estateParcels,
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
      result = await apiComponent.fetchUpdatedData(cursors, {})
    })

    it('should update the tiles of all its parcels', () => {
      expect(result.tiles.length).toBe(150)
    })

    it("should compute the estate's proximity from all its parcels", () => {
      expect(result.estates[0].attributes).toEqual(
        expect.arrayContaining([
          {
            trait_type: 'Distance to Plaza',
            value: 5,
            display_type: 'number',
          },
          { trait_type: 'Distance to Road', value: 0, display_type: 'number' },
        ])
      )
    })
  })

  describe('and more parcels changed in the same second than fit in a page', () => {
    let result: Result

    beforeEach(async () => {
      subgraphComponentMock.query = mockLandUpdates({
        parcels: [0, 1, 2].map((i) => ({
          ...defaultParcel,
          id: `parcel-0x0-${i}`,
          tokenId: `${i}`,
          searchParcelX: `${i}`,
        })),
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
      result = await apiComponent.fetchUpdatedData(cursors, {})
    })

    it('should return all of them', () => {
      expect(result.tiles.map((tile) => tile.id)).toEqual(['0,1', '1,1', '2,1'])
    })
  })

  describe('and parcels and estates changed', () => {
    let queries: string[]

    beforeEach(async () => {
      subgraphComponentMock.query = mockLandUpdates({
        parcels: [fstParcel],
        estates: [fstEstate],
        estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
      await apiComponent.fetchUpdatedData(cursors, {})
      queries = (subgraphComponentMock.query as jest.Mock).mock.calls.map(
        ([query]) => query
      )
    })

    it("should read every page at the snapshot's block", () => {
      expect(
        queries
          .filter((query) => !query.includes('_meta'))
          .every((query) =>
            query.includes(`block: { number: ${PINNED_BLOCK} }`)
          )
      ).toBe(true)
    })

    it('should read the snapshot first', () => {
      expect(queries[0]).toContain('_meta')
    })
  })

  describe('and the rentals sweep is requested', () => {
    let result: Result
    let staleEstateTile: Tile

    beforeEach(() => {
      staleEstateTile = {
        ...defaultFstParcelEstateTile,
        rentalListing: convertRentalListingToTileRentalListing(
          fstEstateRentalListing
        ),
      }
      subgraphComponentMock.query = mockLandUpdates({})
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    describe('and the open listings are fetched', () => {
      beforeEach(async () => {
        rentalsComponentMock.getOpenRentalListings = jest
          .fn()
          .mockResolvedValueOnce([
            {
              ...defaultParcelRentalListing,
              expiration: date + 100000000,
            },
            // still open but already expired
            {
              ...fstEstateRentalListing,
              nftId: `estate-${ESTATE_CONTRACT_ADDRESS}-1`,
              expiration: date - 1000,
            },
          ])
        result = await apiComponent.fetchUpdatedData(
          cursors,
          {
            [defaultParcelTile.id]: defaultParcelTile,
            [staleEstateTile.id]: staleEstateTile,
          },
          { sweepRentals: true }
        )
      })

      it('should add the missing listings and drop the ones that are no longer open or expired', () => {
        expect(result.tiles).toEqual([
          {
            ...defaultParcelTile,
            rentalListing: convertRentalListingToTileRentalListing({
              ...defaultParcelRentalListing,
              expiration: date + 100000000,
            }),
          },
          defaultFstParcelEstateTile,
        ])
      })

      it('should report the sweep as done', () => {
        expect(result.rentalsSwept).toBe(true)
      })
    })

    describe('and an estate listing the tiles show is still open', () => {
      beforeEach(async () => {
        rentalsComponentMock.getOpenRentalListings = jest
          .fn()
          .mockResolvedValueOnce([
            { ...fstEstateRentalListing, expiration: date + 100000000 },
          ])
        result = await apiComponent.fetchUpdatedData(
          cursors,
          { [staleEstateTile.id]: staleEstateTile },
          { sweepRentals: true }
        )
      })

      it('should keep it on the tiles', () => {
        expect(result.tiles).toEqual([])
      })
    })

    describe('and a listing the tiles show is missing from the sweep but still open', () => {
      beforeEach(async () => {
        rentalsComponentMock.getOpenRentalListings = jest
          .fn()
          .mockResolvedValueOnce([])
        rentalsComponentMock.getOpenRentalListingsOfNfts = jest
          .fn()
          .mockResolvedValueOnce([
            { ...fstEstateRentalListing, expiration: date + 100000000 },
          ])
        result = await apiComponent.fetchUpdatedData(
          cursors,
          { [staleEstateTile.id]: staleEstateTile },
          { sweepRentals: true }
        )
      })

      it('should look it up by nft id before removing it', () => {
        expect(
          rentalsComponentMock.getOpenRentalListingsOfNfts
        ).toHaveBeenCalledWith([fstEstateRentalListing.nftId])
      })

      it('should keep it on the tiles', () => {
        expect(result.tiles).toEqual([])
      })
    })

    describe('and fetching the open listings fails', () => {
      beforeEach(async () => {
        rentalsComponentMock.getOpenRentalListings = jest
          .fn()
          .mockRejectedValueOnce(new Error('signatures down'))
        result = await apiComponent.fetchUpdatedData(
          cursors,
          { [staleEstateTile.id]: staleEstateTile },
          { sweepRentals: true }
        )
      })

      it('should keep the current listings and not report the sweep as done', () => {
        expect({ tiles: result.tiles, swept: result.rentalsSwept }).toEqual({
          tiles: [],
          swept: undefined,
        })
      })
    })
  })

  describe('and a parcel left an estate', () => {
    let leavingParcel: ParcelFragment
    let oldTiles: Record<string, Tile>
    let result: Result

    beforeEach(() => {
      leavingParcel = {
        ...defaultParcel,
        searchParcelX: '1',
        searchParcelY: '3',
      }
      oldTiles = {
        '1,3': { ...defaultFstParcelEstateTile, id: '1,3', x: 1, y: 3 },
      }
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    describe('and the estate keeps other parcels', () => {
      beforeEach(async () => {
        subgraphComponentMock.query = mockLandUpdates({
          parcels: [leavingParcel],
          estateParcels: [defaultFstParcelEstate, defaultSndParcelEstate],
        })
        result = await apiComponent.fetchUpdatedData(cursors, oldTiles)
      })

      it('should rebuild the estate from its remaining parcels', () => {
        expect(result.estates).toEqual([fstEstateNFT])
      })
    })

    describe('and the estate was left without parcels', () => {
      beforeEach(async () => {
        subgraphComponentMock.query = mockLandUpdates({
          parcels: [leavingParcel],
          estatesById: [
            { ...fstEstate, estate: { size: 0, data: { description: '' } } },
          ],
        })
        result = await apiComponent.fetchUpdatedData(cursors, oldTiles)
      })

      it('should return the estate as dissolved', () => {
        expect(result.estates).toEqual([
          expect.objectContaining({
            id: '1',
            attributes: [
              { trait_type: 'Size', value: 0, display_type: 'number' },
            ],
          }),
        ])
      })
    })
  })

  describe('and more than a hundred estates were updated', () => {
    let estateQueries: string[]
    let result: Result

    beforeEach(async () => {
      const estates = Array.from({ length: 150 }, (_, i) => ({
        ...fstEstate,
        id: `estate-${ESTATE_CONTRACT_ADDRESS}-${1000 + i}`,
        tokenId: `${1000 + i}`,
      }))
      subgraphComponentMock.query = mockLandUpdates({
        estates,
        estateParcels: estates.map((estate, i) => ({
          ...defaultFstParcelEstate,
          id: `parcel-0x0-e${1000 + i}`,
          searchParcelX: `${i}`,
          searchParcelY: '50',
          searchParcelEstateId: estate.id,
        })),
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
      result = await apiComponent.fetchUpdatedData(cursors, {})
      estateQueries = (subgraphComponentMock.query as jest.Mock).mock.calls
        .map(([query]) => query as string)
        .filter((query) => query.includes('searchParcelEstateId_in'))
    })

    it('should update the tiles of all their parcels', () => {
      expect(result.tiles.length).toBe(150)
    })

    it('should ask for at most a hundred estates per query', () => {
      expect(
        estateQueries.every(
          (query) =>
            JSON.parse(/searchParcelEstateId_in: (\[[^\]]*\])/.exec(query)![1])
              .length <= 100
        )
      ).toBe(true)
    })
  })

  describe('and the pinned block is not available yet on the first try', () => {
    let result: Result

    beforeEach(async () => {
      const land = mockLandUpdates({ parcels: [defaultParcel] })
      let failed = false
      subgraphComponentMock.query = jest.fn((query: string) => {
        if (!failed && !query.includes('_meta')) {
          failed = true
          return Promise.reject(
            new Error(
              'Failed to decode `block.number` value: `subgraph has only indexed up to block number 4 and data for block number 5 is therefore not yet available`'
            )
          )
        }
        return land(query)
      }) as jest.Mock
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
      result = await apiComponent.fetchUpdatedData(cursors, {})
    })

    it('should retry the query and return the changes', () => {
      expect(result.tiles).toEqual([defaultParcelTile])
    })
  })

  describe('and a pinned query fails for another reason', () => {
    beforeEach(() => {
      const land = mockLandUpdates({ parcels: [defaultParcel] })
      subgraphComponentMock.query = jest.fn((query: string) =>
        query.includes('_meta')
          ? land(query)
          : Promise.reject(new Error('Unexpected `}`'))
      ) as jest.Mock
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should fail the update without retrying', async () => {
      await expect(apiComponent.fetchUpdatedData(cursors, {})).rejects.toThrow(
        'Unexpected `}`'
      )
      expect((subgraphComponentMock.query as jest.Mock).mock.calls.length).toBe(
        3
      )
    })
  })

  describe('and the land cursor is set', () => {
    let parcelsQuery: string

    beforeEach(async () => {
      subgraphComponentMock.query = mockLandUpdates({})
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
      await apiComponent.fetchUpdatedData({ ...cursors, land: 10000 }, {})
      parcelsQuery = (subgraphComponentMock.query as jest.Mock).mock.calls
        .map(([query]) => query as string)
        .find((query) => query.includes('category: parcel'))!
    })

    it('should re-read the changes made in the overlap window before it', () => {
      expect(parcelsQuery).toContain('updatedAt_gt: "9700"')
    })
  })

  describe('and calculating the cursors', () => {
    let snapshotTimestamp: number

    beforeEach(() => {
      snapshotTimestamp = fromMillisecondsToSeconds(date) + 10
    })

    describe('and there are no updates', () => {
      beforeEach(() => {
        subgraphComponentMock.query = mockLandUpdates({
          timestamp: snapshotTimestamp,
        })
        rentalsComponentMock.getUpdatedRentalListings = jest
          .fn()
          .mockResolvedValueOnce([])
      })

      it("should move the land cursor to the snapshot block's timestamp and keep the rentals cursor", async () => {
        const result = await apiComponent.fetchUpdatedData(cursors, {})
        expect(result.cursors).toEqual({
          land: snapshotTimestamp,
          rentals: cursors.rentals,
        })
      })
    })

    describe('and there are updates on parcels and listings', () => {
      let maxDateInMilliseconds: number

      beforeEach(() => {
        maxDateInMilliseconds = Date.now()
        subgraphComponentMock.query = mockLandUpdates({
          parcels: [
            {
              ...defaultParcel,
              updatedAt: (snapshotTimestamp - 5).toString(),
            },
          ],
          timestamp: snapshotTimestamp,
        })
        rentalsComponentMock.getUpdatedRentalListings = jest
          .fn()
          .mockResolvedValueOnce([
            { ...defaultParcelRentalListing, updatedAt: maxDateInMilliseconds },
            {
              ...fstEstateRentalListing,
              updatedAt: maxDateInMilliseconds - 1,
            },
          ])
      })

      it("should move the land cursor to the snapshot block's timestamp and the rentals cursor to the newest listing", async () => {
        const result = await apiComponent.fetchUpdatedData(cursors, {})
        expect(result.cursors).toEqual({
          land: snapshotTimestamp,
          rentals: maxDateInMilliseconds,
        })
      })
    })

    describe('and the snapshot is older than the land cursor', () => {
      beforeEach(() => {
        cursors = { ...cursors, land: snapshotTimestamp + 100 }
        subgraphComponentMock.query = mockLandUpdates({
          timestamp: snapshotTimestamp,
        })
        rentalsComponentMock.getUpdatedRentalListings = jest
          .fn()
          .mockResolvedValueOnce([])
      })

      it('should keep the land cursor', async () => {
        const result = await apiComponent.fetchUpdatedData(cursors, {})
        expect(result.cursors.land).toBe(snapshotTimestamp + 100)
      })
    })
  })
})
