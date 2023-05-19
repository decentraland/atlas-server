import { RentalListing, RentalStatus } from '@dcl/schemas'
import {
  IConfigComponent,
  ILoggerComponent,
  IMetricsComponent,
} from '@well-known-components/interfaces'
import { ISubgraphComponent } from '@well-known-components/thegraph-component'
import { convertRentalListingToTileRentalListing } from '../../src/adapters/rentals'
import { fromMillisecondsToSeconds } from '../../src/adapters/time'
import { Metrics } from '../../src/metrics'
import { createApiComponent } from '../../src/modules/api/component'
import {
  EstateFragment,
  IApiComponent,
  NFT,
  ParcelFragment,
} from '../../src/modules/api/types'
import { Tile, TileType } from '../../src/modules/map/types'
import { IRentalsComponent } from '../../src/modules/rentals'

const IMAGE_BASE_URL = 'http://base-image-url.com'
const EXTERNAL_BASE_URL = 'http://external-base-url.com'
const LAND_CONTRACT_ADDRESS = '0x1'
const ESTATE_CONTRACT_ADDRESS = '0x2'
const date = Date.now()

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
    searchParcelEstateId: 'estate-0x0-1',
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
        parcels: [
          { x: '1', y: '1' },
          { x: '1', y: '2' },
        ],
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
    updatedAt: Number(defaultParcel.updatedAt),
    type: TileType.PLAZA,
    top: true,
    left: true,
    topLeft: true,
    name: 'Parcel 0',
    owner: defaultParcel.owner?.id,
    price: 1,
    expiresAt: Math.round(
      parseInt(defaultFstParcelEstate.activeOrder?.expiresAt!, 10) / 1000
    ),
    tokenId: defaultParcel.tokenId,
  }
  defaultFstParcelEstateTile = {
    id: '1,1',
    x: Number(defaultFstParcelEstate.searchParcelX),
    y: Number(defaultFstParcelEstate.searchParcelY),
    updatedAt: Number(defaultFstParcelEstate.updatedAt),
    type: TileType.PLAZA,
    top: true,
    left: true,
    topLeft: true,
    name: 'Estate 0',
    estateId: '1',
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
    updatedAt: Number(defaultSndParcelEstate.updatedAt),
    type: TileType.PLAZA,
    top: true,
    left: true,
    topLeft: true,
    name: 'Estate 0',
    estateId: '1',
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
    getRentalsListingsOfNFTs: jest.fn(),
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
  describe('and fetching the graph fails but the rental listings', () => {
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

  describe('and fetching the rental listings of the retrieved nfts fails', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest
        .fn()
        .mockResolvedValueOnce({ nfts: [{ id: 'aNFTId' }] })
      rentalsComponentMock.getRentalsListingsOfNFTs = jest
        .fn()
        .mockRejectedValueOnce(new Error('An error ocurred'))
    })

    it('should throw an error', () => {
      return expect(apiComponent.fetchData()).rejects.toThrowError(
        'An error ocurred'
      )
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
        .mockResolvedValueOnce({ nfts: nftFragments })
        .mockResolvedValueOnce({ nfts: [] })
      rentalsComponentMock.getRentalsListingsOfNFTs = jest
        .fn()
        .mockResolvedValueOnce({})
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
        updatedAt: Number(defaultParcel.updatedAt),
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

    beforeEach(() => {
      fourthParcel = {
        ...defaultParcel,
        id: 'parcel-0x0-3',
        name: 'Parcel 3',
        searchParcelX: '3',
        searchParcelY: '3',
        searchParcelEstateId: null,
        tokenId: '3',
        activeOrder: null,
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
        searchParcelEstateId: 'estate-0x0-2',
        tokenId: '4',
        parcel: {
          data: {
            name: 'Parcel 4',
            description: '',
          },
          estate: {
            ...defaultFstParcelEstate.parcel.estate!,
            tokenId: '2',
            size: 2,
            parcels: [
              { x: '4', y: '3' },
              { x: '5', y: '3' },
            ],
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
        nftId: fourthParcel.id,
        expiration: date,
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
        .mockResolvedValueOnce({ nfts: nftFragments.splice(0, 3) })
        .mockResolvedValueOnce({ nfts: nftFragments.splice(0, 6) })
        .mockResolvedValueOnce({ nfts: [] })
      rentalsComponentMock.getRentalsListingsOfNFTs = jest
        .fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          [fourthParcelRentalListing.nftId]: fourthParcelRentalListing,
          [fifthParcelEstateRentalListing.nftId]:
            fifthParcelEstateRentalListing,
        })
        .mockResolvedValueOnce({})
    })

    it('should return the tiles, the parcels and the estates with their rental listings', () => {
      return expect(apiComponent.fetchData()).resolves.toEqual({
        tiles: [
          {
            id: '0,1',
            x: Number(defaultParcel.searchParcelX),
            y: Number(defaultParcel.searchParcelY),
            updatedAt: Number(defaultParcel.updatedAt),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Parcel 0',
            owner: defaultParcel.owner?.id,
            price: 1,
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
            updatedAt: Number(defaultFstParcelEstate.updatedAt),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Estate 0',
            estateId: '1',
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
            updatedAt: Number(defaultSndParcelEstate.updatedAt),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Estate 0',
            estateId: '1',
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
            updatedAt: Number(fourthParcel.updatedAt),
            type: 'plaza',
            top: true,
            left: true,
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
            updatedAt: Number(fifthParcelEstate.updatedAt),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Estate 1',
            estateId: '2',
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
            updatedAt: Number(sixthParcelEstate.updatedAt),
            type: 'plaza',
            top: true,
            left: true,
            topLeft: true,
            name: 'Estate 1',
            estateId: '2',
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
        updatedAt: Number(defaultParcel.updatedAt),
      })
    })
  })
})

describe('when fetching update data', () => {
  let fstEstate: EstateFragment
  let defaultParcelRentalListing: RentalListing
  let fstEstateRentalListing: RentalListing

  beforeEach(() => {
    fstEstate = {
      updatedAt: fromMillisecondsToSeconds(date).toString(),
      estate: {
        parcels: [
          { nft: defaultFstParcelEstate },
          { nft: defaultSndParcelEstate },
        ],
      },
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
        .mockResolvedValueOnce([])
    })

    it('should continue with the update and log the error', async () => {
      await expect(apiComponent.fetchUpdatedData(0, {})).resolves.toEqual({
        tiles: [],
        parcels: [],
        estates: [],
        updatedAt: 0,
      })

      expect(loggerErrorMock).toHaveBeenCalledWith(
        `Failed to retrieve updated information about the lands: Error: An error ocurred`
      )

      expect(metricsIncrementMock).toBeCalledWith('dcl_map_update', {
        type: 'land',
        status: 'failure',
      })
      expect(metricsIncrementMock).toBeCalledWith('dcl_map_update', {
        type: 'rental',
        status: 'success',
      })
    })
  })

  describe("and fetching the rental listings fails but the graph fetch doesn't", () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest
        .fn()
        .mockResolvedValueOnce({ parcels: [], estates: [] })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockRejectedValueOnce(new Error('An error ocurred'))
    })

    it('should continue with the update and log the error', async () => {
      await expect(apiComponent.fetchUpdatedData(0, {})).resolves.toEqual({
        tiles: [],
        parcels: [],
        estates: [],
        updatedAt: 0,
      })

      expect(loggerErrorMock).toHaveBeenCalledWith(
        `Failed to retrieve updated information about the rental listings: Error: An error ocurred`
      )

      expect(metricsIncrementMock).toBeCalledWith('dcl_map_update', {
        type: 'rental',
        status: 'failure',
      })
      expect(metricsIncrementMock).toBeCalledWith('dcl_map_update', {
        type: 'land',
        status: 'success',
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

    it('should end the update and log the errors', async () => {
      await expect(apiComponent.fetchUpdatedData(0, {})).resolves.toEqual({
        tiles: [],
        parcels: [],
        estates: [],
        updatedAt: 0,
      })

      expect(loggerErrorMock).toHaveBeenCalledWith(
        `Failed to retrieve updated information about the rental listings: Error: An error ocurred`
      )
      expect(loggerErrorMock).toHaveBeenCalledWith(
        `Failed to retrieve updated information about the lands: Error: An error ocurred`
      )
      expect(metricsIncrementMock).toBeCalledWith('dcl_map_update', {
        type: 'land',
        status: 'failure',
      })
      expect(metricsIncrementMock).toBeCalledWith('dcl_map_update', {
        type: 'rental',
        status: 'failure',
      })
    })
  })

  describe('and there are no parcels, estates or rental listings updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest
        .fn()
        .mockResolvedValueOnce({ parcels: [], estates: [] })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should return a batched list of empty assets to update', () => {
      return expect(apiComponent.fetchUpdatedData(100000, {})).resolves.toEqual(
        {
          tiles: [],
          parcels: [],
          estates: [],
          updatedAt: 100000,
        }
      )
    })
  })

  describe('and there are only parcels to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest
        .fn()
        .mockResolvedValueOnce({ parcels: [defaultParcel], estates: [] })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should return a batched list of tiles and parcels to update', () => {
      return expect(apiComponent.fetchUpdatedData(100000, {})).resolves.toEqual(
        {
          tiles: [defaultParcelTile],
          parcels: [defaultParcelNFT],
          estates: [],
          updatedAt: defaultParcelTile.updatedAt,
        }
      )
    })
  })

  describe('and there are only estates to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest
        .fn()
        .mockResolvedValueOnce({ parcels: [], estates: [fstEstate] })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should return a batched list of tiles and estates to update', () => {
      return expect(apiComponent.fetchUpdatedData(100000, {})).resolves.toEqual(
        {
          tiles: [defaultFstParcelEstateTile, defaultSndParcelEstateTile],
          parcels: [defaultFstParcelEstateNFT, defaultSndParcelEstateNFT],
          estates: [fstEstateNFT],
          updatedAt: Number(fstEstate.updatedAt),
        }
      )
    })
  })

  describe('and there are parcels and estates to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest.fn().mockResolvedValueOnce({
        parcels: [defaultParcel],
        estates: [fstEstate],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([])
    })

    it('should return a batched list of tiles, parcels and estates to update', () => {
      return expect(apiComponent.fetchUpdatedData(100000, {})).resolves.toEqual(
        {
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
          updatedAt: Number(fstEstate.updatedAt),
        }
      )
    })
  })

  describe('and there are only listings that belong to a parcel to be be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest.fn().mockResolvedValueOnce({
        parcels: [],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([defaultParcelRentalListing])
    })

    it('should return a batched list of tiles to update with their rental listings updated', () => {
      return expect(
        apiComponent.fetchUpdatedData(100000, {
          [defaultParcelTile.id]: defaultParcelTile,
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultParcelTile,
            rentalListing: convertRentalListingToTileRentalListing(
              defaultParcelRentalListing
            ),
          },
        ],
        parcels: [],
        estates: [],
        updatedAt: Number(defaultParcelTile.updatedAt),
      })
    })
  })

  describe('and there are only listings that belong to an estate to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest.fn().mockResolvedValueOnce({
        parcels: [],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([fstEstateRentalListing])
    })

    it('should return a batched list of tiles to update with their rental listings updated', () => {
      return expect(
        apiComponent.fetchUpdatedData(100000, {
          [defaultFstParcelEstate.id]: defaultFstParcelEstateTile,
          [defaultSndParcelEstate.id]: defaultSndParcelEstateTile,
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultFstParcelEstateTile,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
          {
            ...defaultSndParcelEstateTile,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
        ],
        parcels: [],
        estates: [],
        updatedAt: Number(defaultFstParcelEstateTile.updatedAt),
      })
    })
  })

  describe('and there are only listing that belong to estates and parcels to be updated', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest.fn().mockResolvedValueOnce({
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
        apiComponent.fetchUpdatedData(100000, {
          [defaultParcelTile.id]: defaultParcelTile,
          [defaultFstParcelEstate.id]: defaultFstParcelEstateTile,
          [defaultSndParcelEstate.id]: defaultSndParcelEstateTile,
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultParcelTile,
            rentalListing: convertRentalListingToTileRentalListing(
              defaultParcelRentalListing
            ),
          },
          {
            ...defaultFstParcelEstateTile,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
          {
            ...defaultSndParcelEstateTile,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
        ],
        parcels: [],
        estates: [],
        updatedAt: Number(defaultFstParcelEstateTile.updatedAt),
      })
    })
  })

  describe('and there are only rental listings that belong to parcels that are not open anymore', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest.fn().mockResolvedValueOnce({
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
        apiComponent.fetchUpdatedData(100000, {
          [defaultParcelTile.id]: {
            ...defaultParcelTile,
            rentalListing: defaultParcelRentalListing,
          },
        })
      ).resolves.toEqual({
        tiles: [defaultParcelTile],
        parcels: [],
        estates: [],
        updatedAt: Number(defaultParcelTile.updatedAt),
      })
    })
  })

  describe('and there are only rental listings that belong to estates that are not open anymore', () => {
    beforeEach(() => {
      subgraphComponentMock.query = jest.fn().mockResolvedValueOnce({
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
        apiComponent.fetchUpdatedData(100000, {
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
        tiles: [defaultFstParcelEstateTile, defaultSndParcelEstateTile],
        parcels: [],
        estates: [],
        updatedAt: Number(defaultFstParcelEstateTile.updatedAt),
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

      subgraphComponentMock.query = jest.fn().mockResolvedValueOnce({
        parcels: [updatedDefaultParcel],
        estates: [],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([defaultParcelRentalListing])
    })

    it('should return a batched list of tiles to update with their rental listings updated', () => {
      return expect(
        apiComponent.fetchUpdatedData(100000, {
          [defaultParcelTile.id]: defaultParcelTile,
        })
      ).resolves.toEqual({
        tiles: [updatedDefaultParcelTile],
        parcels: [updatedDefaultParcelNFT],
        estates: [],
        updatedAt: Number(updatedDefaultParcel.updatedAt),
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
          estate: {
            ...defaultFstParcelEstate.parcel.estate!,
            parcels: [
              ...defaultFstParcelEstate.parcel.estate!.parcels,
              { x: '0', y: '2' },
            ],
          },
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
        estate: {
          ...fstEstate.estate,
          parcels: [
            ...fstEstate.estate.parcels,
            {
              nft: updatedDefaultParcelIntoFstEstate,
            },
          ],
        },
      }
      subgraphComponentMock.query = jest.fn().mockResolvedValueOnce({
        parcels: [updatedDefaultParcelIntoFstEstate],
        estates: [updatedFstEstate],
      })
      rentalsComponentMock.getUpdatedRentalListings = jest
        .fn()
        .mockResolvedValueOnce([fstEstateRentalListing])
    })

    it('should return a batched list of tiles, parcels and estates to update with their rental listings updated', () => {
      return expect(
        apiComponent.fetchUpdatedData(100000, {
          [defaultParcel.id]: defaultParcelTile,
          [defaultFstParcelEstate.id]: defaultFstParcelEstateTile,
          [defaultSndParcelEstate.id]: defaultSndParcelEstateTile,
        })
      ).resolves.toEqual({
        tiles: [
          {
            ...defaultFstParcelEstateTile,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
          {
            ...defaultSndParcelEstateTile,
            rentalListing: convertRentalListingToTileRentalListing(
              fstEstateRentalListing
            ),
          },
          {
            ...updatedDefaultParcelTileIntoFstEstate,
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
        updatedAt: Number(defaultFstParcelEstateTile.updatedAt),
      })
    })
  })
})
