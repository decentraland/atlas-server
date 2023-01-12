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
const LIMIT_RENTAL_LISTINGS = 100

export async function createRentalsComponent(components: {
  config: IConfigComponent
  fetch: IFetchComponent
}): Promise<IRentalsComponent> {
  const { config, fetch: fetchComponent } = components
  const signaturesServerURL = await config.requireString(
    'SIGNATURES_SERVER_URL'
  )

  /** Gets the rental listings from the given path.
   * @param path The signatures' server path to be used when querying rental listings.
   * @throws An error if the request fails.
   */
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

  /** Gets the open rental listings of the NFTs identified by the given NFT ids.
   * @param nftIds The ids of the NFTs to get the rental listings for.
   * @throws An error if the request fails.
   */
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

  /** Gets the updated rental listings that were updated after the given date.
   * @param updatedAfter A UTC timestamp in milliseconds of the rental listings update time.
   * @throws An error if the request fails.
   */
  async function getUpdatedRentalListings(
    updatedAfter: number
  ): Promise<RentalListing[]> {
    let remainingRentalListings = 0
    let rentalListings: RentalListing[] = []
    do {
      const updatedRentalListings = await fetchRentalListings(
        `/v1/rentals-listings?updatedAfter=${updatedAfter}&limit=${LIMIT_RENTAL_LISTINGS}&offset=${rentalListings.length}`
      )
      rentalListings = rentalListings.concat(updatedRentalListings.data.results)
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
