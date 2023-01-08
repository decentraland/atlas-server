import { RentalListing } from '@dcl/schemas'

export function isExpired(rentalListing: RentalListing) {
  return rentalListing.expiration < Date.now()
}
