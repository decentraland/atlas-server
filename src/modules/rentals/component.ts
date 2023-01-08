import pLimit from 'p-limit'
import { RentalStatus, RentalListing } from '@dcl/schemas'
import { IFetchComponent } from '@well-known-components/http-server'
import { IConfigComponent } from '@well-known-components/interfaces'
import {
  IRentalsComponent,
  SignaturesServerPaginatedResponse,
  SignaturesServerErrorResponse,
} from './types'

const HTTP_MAX_URL_LENGTH = 2048
const MAX_CONCURRENT_REQUEST = 2

export async function createRentalsComponent(components: {
  config: IConfigComponent
  fetch: IFetchComponent
}): Promise<IRentalsComponent> {
  const { config, fetch: fetchComponent } = components
  const signaturesServerURL = await config.requireString(
    'SIGNATURES_SERVER_URL'
  )

  async function fetchRentalListings(
    path: string
  ): Promise<SignaturesServerPaginatedResponse<RentalListing[]>> {
    const response = await fetchComponent.fetch(
      `${signaturesServerURL}${path}`,
      {
        headers: {
          'User-agent': 'Atlas server',
        },
      }
    )

    if (!response.ok) {
      let parsedErrorResult: SignaturesServerErrorResponse<any> | undefined
      try {
        parsedErrorResult = await response.json()
      } catch (_) {
        // Ignore the JSON parse result error error.
      }

      if (parsedErrorResult) {
        throw new Error(parsedErrorResult.message)
      }

      throw new Error(
        `Error fetching rentals, the server responded with: ${response.status}`
      )
    }

    const parsedResult = await response.json()
    if (!parsedResult.ok) {
      throw new Error(parsedResult.message)
    }

    return parsedResult
  }

  async function getRentalsListingsOfNFTs(
    nftIds: string[]
  ): Promise<Record<string, RentalListing>> {
    const baseUrl = `/v1/rentals-listings?rentalStatus=${RentalStatus.OPEN}`
    const limit = pLimit(MAX_CONCURRENT_REQUEST)

    // Build URLs to get all the queried NFTs
    let urls: string[] = []
    let url = baseUrl
    for (let nftId of nftIds) {
      if (url.length < HTTP_MAX_URL_LENGTH - signaturesServerURL.length) {
        url += `&nftIds=${nftId}`
      } else {
        urls.push(url)
        url = baseUrl + `&nftIds=${nftId}`
      }
    }

    // Push the last url
    if (url !== baseUrl) {
      urls.push(url)
    }

    const results: SignaturesServerPaginatedResponse<RentalListing[]>[] =
      await Promise.all(
        urls.map((url) =>
          limit(async () =>
            fetchRentalListings(url).catch((error) => {
              limit.clearQueue()
              throw error
            })
          )
        )
      )

    return results
      .flatMap((result) => result.data.results)
      .reduce((rentalListings, rentalListing) => {
        return {
          ...rentalListings,
          [rentalListing.nftId]: rentalListing,
        }
      }, {})
  }

  async function getUpdatedRentalListings(
    updatedAfter: number
  ): Promise<RentalListing[]> {
    const baseUrl = `${signaturesServerURL}/v1/rentals-listings?updatedAfter=${updatedAfter}`
    let remainingRentalListings = 0
    let rentalListings: RentalListing[] = []
    do {
      const updatedRentalListings = await fetchRentalListings(
        `${baseUrl}&limit=100&skip=100`
      )
      rentalListings = updatedRentalListings.data.results.concat(rentalListings)
      remainingRentalListings =
        updatedRentalListings.data.total - rentalListings.length
    } while (remainingRentalListings > 0)

    return rentalListings
  }

  return {
    getRentalsListingsOfNFTs,
    getUpdatedRentalListings,
  }
}
