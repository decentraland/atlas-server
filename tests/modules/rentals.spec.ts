import { RentalListing } from '@dcl/schemas'
import { IFetchComponent } from '@well-known-components/http-server'
import {
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'
import {
  createRentalsComponent,
  IRentalsComponent,
  SignaturesServerPaginatedResponse,
} from '../../src/modules/rentals'

const rentalsURL = 'http://rentals.com'
const error = 'An error occurred'

let fetchComponentMock: IFetchComponent
let loggerComponentMock: ILoggerComponent
let configComponentMock: IConfigComponent
let fetchResponse: Response
let rentalsComponent: IRentalsComponent
let fetchMock: jest.Mock
let rentalIds: string[]

beforeEach(async () => {
  fetchMock = jest.fn()
  loggerComponentMock = {
    getLogger: () =>
      ({
        info: jest.fn(),
      } as any),
  }
  configComponentMock = {
    getNumber: jest.fn(),
    getString: jest.fn(),
    requireNumber: jest.fn(),
    requireString: jest.fn().mockResolvedValueOnce(rentalsURL),
  }
  fetchComponentMock = {
    fetch: fetchMock,
  }
  rentalsComponent = await createRentalsComponent({
    config: configComponentMock,
    fetch: fetchComponentMock,
    logger: loggerComponentMock,
  })
})

describe('when getting the open rental listings by NFT id', () => {
  let result: Record<string, RentalListing>
  let responses: SignaturesServerPaginatedResponse<RentalListing[]>[]
  let expectedResult: Record<string, RentalListing>

  describe("and the list of rental ids doesn't exhaust the length of the signature server's URL", () => {
    beforeEach(async () => {
      rentalIds = Array.from({ length: 2 }, (_, i) => `parcel-${i}`)
      responses = [
        {
          ok: true,
          data: {
            results: rentalIds.map((id) => ({
              id,
              nftId: id,
            })) as RentalListing[],
            page: 1,
            pages: 1,
            limit: 50,
            total: 2,
          },
        },
      ]
      expectedResult = responses[0].data.results.reduce(
        (acc, curr) => ({
          ...acc,
          [curr.id]: curr,
        }),
        {}
      )
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce(responses[0]),
      })

      result = await rentalsComponent.getRentalsListingsOfNFTs(rentalIds)
    })

    it('should fetch and return the rental listings once', () => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should have queried all the nft ids', () => {
      const parsedUrl = new URL(fetchMock.mock.calls[0][0])
      expect(parsedUrl.searchParams.getAll('nftIds')).toEqual(rentalIds)
    })

    it('should return the rental listings', () => {
      expect(result).toEqual(expectedResult)
    })
  })

  describe("and the list of rental ids exhausts the length of the signature server's URL twice", () => {
    beforeEach(async () => {
      rentalIds = Array.from({ length: 200 }, (_, i) => `parcel-${i}`)
      responses = [
        {
          ok: true,
          data: {
            results: rentalIds.map((id) => ({
              id,
              nftId: id,
            })) as RentalListing[],
            page: 1,
            pages: 2,
            limit: 50,
            total: 500,
          },
        },
        {
          ok: true,
          data: {
            results: rentalIds.map((id) => ({
              id,
              nftId: id,
            })) as RentalListing[],
            page: 2,
            pages: 2,
            limit: 50,
            total: 500,
          },
        },
      ]
      expectedResult = responses
        .flatMap((resp) => resp.data.results)
        .reduce(
          (acc, curr) => ({
            ...acc,
            [curr.id]: curr,
          }),
          {}
        )
      responses.forEach((response) => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValueOnce(response),
        })
      })

      result = await rentalsComponent.getRentalsListingsOfNFTs(rentalIds)
    })

    it('should fetch and return the rental listings twice', () => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should have queried all the nft ids', () => {
      expect(
        fetchMock.mock.calls.flatMap((call) =>
          new URL(call[0]).searchParams.getAll('nftIds')
        )
      ).toEqual(rentalIds)
    })

    it('should return the rental listings', () => {
      expect(result).toEqual(expectedResult)
    })
  })

  describe('and fetching the list of rental fails', () => {
    beforeEach(() => {
      rentalIds = Array.from({ length: 1 }, (_, i) => `parcel-${i}`)
      fetchResponse = {
        status: 500,
        json: jest.fn().mockResolvedValueOnce({
          ok: false,
          message: error,
        }) as any,
      } as Response
      fetchMock.mockResolvedValueOnce(fetchResponse)
    })

    it('should throw an error with the message returned in the JSON message', () => {
      return expect(
        rentalsComponent.getRentalsListingsOfNFTs(rentalIds)
      ).rejects.toThrowError(error)
    })

    it('should return the rental listings', () => {
      expect(result).toEqual(expectedResult)
    })
  })
})

describe('when getting the updated rental listings', () => {
  const updatedAfter = 1673269193336
  let responses: SignaturesServerPaginatedResponse<RentalListing[]>[]
  let result: RentalListing[]

  describe('and there are no updated rental listings', () => {
    beforeEach(async () => {
      responses = [
        {
          ok: true,
          data: {
            results: [],
            page: 1,
            pages: 1,
            limit: 100,
            total: 0,
          },
        },
      ]
      fetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce(responses[0]) as any,
      } as Response
      fetchMock.mockResolvedValueOnce(fetchResponse)
      result = await rentalsComponent.getUpdatedRentalListings(updatedAfter)
    })

    it('should fetch and return the rental listings once', () => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should return the rental listings', () => {
      expect(result).toEqual([])
    })
  })

  describe('and there are no updated rental listings', () => {
    beforeEach(async () => {
      responses = [
        {
          ok: true,
          data: {
            results: [],
            page: 1,
            pages: 1,
            limit: 100,
            total: 0,
          },
        },
      ]
      fetchResponse = {
        ok: true,
        status: 200,
        json: jest.fn().mockResolvedValueOnce(responses[0]) as any,
      } as Response
      fetchMock.mockResolvedValueOnce(fetchResponse)
      result = await rentalsComponent.getUpdatedRentalListings(updatedAfter)
    })

    it('should fetch and return the rental listings once', () => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('should return the rental listings', () => {
      expect(result).toEqual([])
    })
  })

  describe('and there are more updated rental listings than the limit', () => {
    let expectedResult: RentalListing[]

    beforeEach(async () => {
      expectedResult = Array.from(
        { length: 200 },
        (_, i) => ({ id: i, nftId: `parcel-${i}` } as unknown as RentalListing)
      )
      responses = [
        {
          ok: true,
          data: {
            results: expectedResult.slice(0, 100),
            page: 1,
            pages: 2,
            limit: 100,
            total: 200,
          },
        },
        {
          ok: true,
          data: {
            results: expectedResult.slice(100, 200),
            page: 1,
            pages: 2,
            limit: 100,
            total: 200,
          },
        },
      ]
      responses.forEach((response) => {
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: jest.fn().mockResolvedValueOnce(response),
        })
      })
      result = await rentalsComponent.getUpdatedRentalListings(updatedAfter)
    })

    it('should fetch and return the rental listings twice', () => {
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('should fetch the rental listings with the correct offset', () => {
      expect(fetchMock).toHaveBeenCalledWith(
        `${rentalsURL}/v1/rentals-listings?updatedAfter=${updatedAfter}&limit=100&offset=0`,
        expect.anything()
      )
      expect(fetchMock).toHaveBeenCalledWith(
        `${rentalsURL}/v1/rentals-listings?updatedAfter=${updatedAfter}&limit=100&offset=100`,
        expect.anything()
      )
    })

    it('should return the rental listings', () => {
      expect(result).toEqual(expectedResult)
    })
  })

  describe('and fetching the updated rental listings fails', () => {
    beforeEach(() => {
      fetchResponse = {
        status: 500,
        json: jest.fn().mockResolvedValueOnce({
          ok: false,
          message: error,
        }) as any,
      } as Response
      fetchMock.mockResolvedValueOnce(fetchResponse)
    })

    it('should throw an error with the message returned in the JSON message', () => {
      return expect(
        rentalsComponent.getUpdatedRentalListings(updatedAfter)
      ).rejects.toThrowError(error)
    })
  })
})
