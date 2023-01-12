"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const schemas_1 = require("@dcl/schemas");
const rentals_1 = require("../../src/adapters/rentals");
describe('when converting a rental listing to a tile rental listing', () => {
    let rentalListing;
    beforeEach(() => {
        rentalListing = {
            id: 'string',
            nftId: 'aNFTId',
            category: schemas_1.NFTCategory.PARCEL,
            searchText: 'aSearchText',
            network: schemas_1.Network.ETHEREUM,
            chainId: schemas_1.ChainId.ETHEREUM_GOERLI,
            expiration: Date.now() + 1000000,
            signature: '0x000',
            nonces: ['0', '0', '0'],
            tokenId: '0',
            contractAddress: '0x1',
            rentalContractAddress: '0x2',
            lessor: '0x3',
            tenant: null,
            status: schemas_1.RentalStatus.OPEN,
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
        };
    });
    it('should return the tile version of the rental listing', () => {
        expect((0, rentals_1.convertRentalListingToTileRentalListing)(rentalListing)).toEqual({
            expiration: rentalListing.expiration,
            periods: rentalListing.periods,
        });
    });
});
