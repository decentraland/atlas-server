import { RentalListing } from '@dcl/schemas'

export type TileRentalListing = Pick<RentalListing, 'expiration' | 'periods'>

export function convertRentalListingToTileRentalListing(
  rentalListing: RentalListing
): TileRentalListing {
  return {
    expiration: rentalListing.expiration,
    periods: rentalListing.periods,
  }
}
