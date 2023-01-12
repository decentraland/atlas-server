import {
  ChainId,
  Network,
  NFTCategory,
  RentalListing,
  RentalStatus,
} from '@dcl/schemas'
import { convertRentalListingToTileRentalListing } from '../../src/adapters/rentals'

describe('when converting a rental listing to a tile rental listing', () => {
  let rentalListing: RentalListing
  beforeEach(() => {
    rentalListing = {
      id: 'string',
      nftId: 'aNFTId',
      category: NFTCategory.PARCEL,
      searchText: 'aSearchText',
      network: Network.ETHEREUM,
      chainId: ChainId.ETHEREUM_GOERLI,
      expiration: Date.now() + 1000000,
      signature: '0x000',
      nonces: ['0', '0', '0'],
      tokenId: '0',
      contractAddress: '0x1',
      rentalContractAddress: '0x2',
      lessor: '0x3',
      tenant: null,
      status: RentalStatus.OPEN,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: null,
      periods: [
        {
          minDays: 1,
          maxDays: 1,
          pricePerDay: '100000000000000000000000000',
        },
      ],
      target: '0x0',
      rentedDays: null,
    }
  })

  it('should return the tile version of the rental listing', () => {
    expect(convertRentalListingToTileRentalListing(rentalListing)).toEqual({
      expiration: rentalListing.expiration,
      periods: rentalListing.periods,
    })
  })
})
