import { RentalListing, RentalStatus } from '@dcl/schemas'
import { TileRentalListing } from '../adapters/rentals'

export function isExpired(rentalListing: TileRentalListing) {
  return rentalListing.expiration < Date.now()
}

export function isRentalListingOpen(rentalListing: RentalListing) {
  return rentalListing.status === RentalStatus.OPEN
}
