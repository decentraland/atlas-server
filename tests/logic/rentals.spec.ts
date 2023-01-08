import { RentalListing } from '@dcl/schemas'
import { isExpired } from '../../src/logic/rental'

describe('when checking if a rental listing is expired', () => {
  let rentalListing: RentalListing
  beforeEach(() => {
    rentalListing = { expiration: 0 } as RentalListing
  })

  describe('and the listing is not expired', () => {
    beforeEach(() => {
      rentalListing.expiration = Date.now() + 20000000
    })

    it('should return false', () => {
      expect(isExpired(rentalListing)).toBe(false)
    })
  })

  describe('and the listing is expired', () => {
    beforeEach(() => {
      rentalListing.expiration = Date.now() - 20000000
    })

    it('should return true', () => {
      expect(isExpired(rentalListing)).toBe(true)
    })
  })
})
