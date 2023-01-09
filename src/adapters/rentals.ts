import { RentalListing } from '@dcl/schemas'

export type TileRentalListing = Pick<
  RentalListing,
  'expiration' | 'createdAt' | 'periods'
>

export function convertRentalListingToTileRentalListing(
  rentalListing: RentalListing
): TileRentalListing {
  return {
    expiration: rentalListing.expiration,
    createdAt: rentalListing.createdAt,
    periods: rentalListing.periods,
  }
}
