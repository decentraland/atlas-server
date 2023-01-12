import { RentalListing } from '@dcl/schemas'

export type SignaturesServerPaginatedResponse<T> = {
  ok: boolean
  data: {
    results: T
    total: number
    page: number
    pages: number
    limit: number
  }
}

export type SignaturesServerErrorResponse<T> = {
  ok: boolean
  message: string
  data?: T
}

export type IRentalsComponent = {
  getRentalsListingsOfNFTs(
    nftIds: string[]
  ): Promise<Record<string, RentalListing>>
  getUpdatedRentalListings(updatedAfter: number): Promise<RentalListing[]>
}
