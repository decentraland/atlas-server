import { RentalStatus, RentalListing } from '@dcl/schemas'
import { IFetchComponent } from '@dcl/core-commons'
import {
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'
import {
  IRentalsComponent,
  SignaturesServerPaginatedResponse,
  SignaturesServerErrorResponse,
} from './types'

const LIMIT_RENTAL_LISTINGS = 100
const RENTALS_REQUEST_TIMEOUT = 30000

export async function createRentalsComponent(components: {
  config: IConfigComponent
  fetch: IFetchComponent
  logger: ILoggerComponent
}): Promise<IRentalsComponent> {
  const { config, fetch: fetchComponent, logger } = components
  const componentLogger = logger.getLogger('Rentals component')
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
    // the fetch timeout stops at the headers; the deadline also bounds reading the body
    const abortController = new AbortController()
    const deadline = setTimeout(
      () => abortController.abort(),
      RENTALS_REQUEST_TIMEOUT
    )
    try {
      const response = await fetchComponent.fetch(
        `${signaturesServerURL}${path}`,
        {
          headers: {
            'User-agent': 'Atlas server',
          },
          timeout: RENTALS_REQUEST_TIMEOUT,
          abortController,
        }
      )
      if (!response.ok) {
        let parsedErrorResult: SignaturesServerErrorResponse<any> | undefined
        try {
          parsedErrorResult = await response.json()
        } catch (_) {
          // Ignore the JSON parse result error error.
          // The body was not consumed by json(), so cancel it to avoid
          // leaking the undrained response stream before throwing below.
          await response.body?.cancel().catch(() => undefined)
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
    } finally {
      clearTimeout(deadline)
    }
  }

  /** Gets every open rental listing, page by page.
   * @throws An error if a request fails.
   */
  async function getOpenRentalListings(): Promise<RentalListing[]> {
    let total = 0
    let rentalListings: RentalListing[] = []
    componentLogger.info(`Starting to fetch the open rental listings`)
    do {
      const page = await fetchRentalListings(
        `/v1/rentals-listings?status=${RentalStatus.OPEN}&limit=${LIMIT_RENTAL_LISTINGS}&offset=${rentalListings.length}`
      )
      rentalListings = rentalListings.concat(page.data.results)
      total = page.data.total
      if (page.data.results.length === 0) {
        break
      }
    } while (rentalListings.length < total)
    componentLogger.info(
      `Finished fetching ${rentalListings.length} open rental listings`
    )
    // Although no returned rental should be null or undefined, there have been cases where the rental listing was not accessible
    return rentalListings.filter(Boolean)
  }

  /** Gets the open rental listings of the given NFTs, a page of ids at a time.
   * @param nftIds The ids of the NFTs (parcels or estates).
   * @throws An error if a request fails.
   */
  async function getOpenRentalListingsOfNfts(
    nftIds: string[]
  ): Promise<RentalListing[]> {
    const rentalListings: RentalListing[] = []
    for (let i = 0; i < nftIds.length; i += LIMIT_RENTAL_LISTINGS) {
      const ids = nftIds.slice(i, i + LIMIT_RENTAL_LISTINGS)
      const page = await fetchRentalListings(
        `/v1/rentals-listings?status=${
          RentalStatus.OPEN
        }&limit=${LIMIT_RENTAL_LISTINGS}&${ids
          .map((id) => `nftIds=${encodeURIComponent(id)}`)
          .join('&')}`
      )
      rentalListings.push(...page.data.results.filter(Boolean))
    }
    return rentalListings
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
    componentLogger.info(`Starting to fetch the updated rental listings`)
    do {
      componentLogger.info(
        `Requesting rental listings: /v1/rentals-listings?updatedAfter=${updatedAfter}&limit=${LIMIT_RENTAL_LISTINGS}&offset=${rentalListings.length}`
      )
      const updatedRentalListings = await fetchRentalListings(
        `/v1/rentals-listings?updatedAfter=${updatedAfter}&limit=${LIMIT_RENTAL_LISTINGS}&offset=${rentalListings.length}`
      )
      rentalListings = rentalListings.concat(updatedRentalListings.data.results)
      remainingRentalListings =
        updatedRentalListings.data.total - rentalListings.length
    } while (remainingRentalListings > 0)
    componentLogger.info(`Finished to fetch the updated rental listings`)
    // Although no returned rental should be null or undefined, there have been cases where the rental listing was not accessible
    // this is a temporary change to see if the access problems were related to retrieved rental listings
    return rentalListings.filter(Boolean)
  }

  return {
    getOpenRentalListings,
    getOpenRentalListingsOfNfts,
    getUpdatedRentalListings,
  }
}
