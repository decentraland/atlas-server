import { RentalListing } from '@dcl/schemas'
import { IFetchComponent } from '@dcl/core-commons'
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

describe('when getting the open rental listings', () => {
  let result: RentalListing[]
  let firstPage: RentalListing[]
  let secondPage: RentalListing[]

  describe('and they span more than one page', () => {
    beforeEach(async () => {
      firstPage = Array.from(
        { length: 100 },
        (_, i) => ({ id: `${i}`, nftId: `parcel-${i}` } as RentalListing)
      )
      secondPage = [{ id: '100', nftId: 'parcel-100' } as RentalListing]
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              ok: true,
              data: { results: firstPage, total: 101, page: 0, pages: 2 },
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              ok: true,
              data: { results: secondPage, total: 101, page: 1, pages: 2 },
            }),
        })
      result = await rentalsComponent.getOpenRentalListings()
    })

    afterEach(() => {
      fetchMock.mockReset()
    })

    it('should request every page of open listings', () => {
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        `${rentalsURL}/v1/rentals-listings?status=open&limit=100&offset=0`,
        `${rentalsURL}/v1/rentals-listings?status=open&limit=100&offset=100`,
      ])
    })

    it('should return the listings of all pages', () => {
      expect(result).toEqual([...firstPage, ...secondPage])
    })
  })

  describe('and the response body stalls', () => {
    let request: Promise<RentalListing[]>

    beforeEach(async () => {
      jest.useFakeTimers()
      fetchMock.mockImplementationOnce(
        async (
          _url: string,
          options: { abortController: AbortController }
        ) => ({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              const { signal } = options.abortController
              if (signal.aborted) {
                reject(new Error('The operation was aborted'))
              }
              signal.addEventListener('abort', () =>
                reject(new Error('The operation was aborted'))
              )
            }),
        })
      )
      request = rentalsComponent.getOpenRentalListings()
      request.catch(() => undefined)
      await jest.advanceTimersByTimeAsync(30000)
    })

    afterEach(() => {
      jest.useRealTimers()
    })

    it('should abort the request once the deadline passes', () => {
      return expect(request).rejects.toThrow('The operation was aborted')
    })
  })

  describe('and fetching a page fails', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ ok: false, message: error }),
      })
    })

    afterEach(() => {
      fetchMock.mockReset()
    })

    it('should throw the error returned by the server', () => {
      return expect(
        rentalsComponent.getOpenRentalListings()
      ).rejects.toThrowError(error)
    })
  })
})

describe('when getting the open rental listings of some nfts', () => {
  let result: RentalListing[]

  beforeEach(async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          ok: true,
          data: {
            results: [{ id: '1', nftId: 'estate-0x2-1' }],
            total: 1,
            page: 0,
            pages: 1,
          },
        }),
    })
    result = await rentalsComponent.getOpenRentalListingsOfNfts([
      'estate-0x2-1',
      'parcel-0x1-5',
    ])
  })

  afterEach(() => {
    fetchMock.mockReset()
  })

  it('should ask for the open listings of those nfts only', () => {
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${rentalsURL}/v1/rentals-listings?status=open&limit=100&nftIds=estate-0x2-1&nftIds=parcel-0x1-5`,
    ])
  })

  it('should return the listings found', () => {
    expect(result).toEqual([{ id: '1', nftId: 'estate-0x2-1' }])
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
