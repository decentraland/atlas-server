import { RentalListing } from '@dcl/schemas'

export type TileRentalListing = Pick<RentalListing, 'expiration' | 'periods' | 'updatedAt'>

export function convertRentalListingToTileRentalListing(
  rentalListing: RentalListing
): TileRentalListing {
  return {
    expiration: rentalListing.expiration,
    periods: rentalListing.periods,
    updatedAt: rentalListing.updatedAt
  }
}
