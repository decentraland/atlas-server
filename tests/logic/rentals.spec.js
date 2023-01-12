"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const rental_1 = require("../../src/logic/rental");
describe('when checking if a rental listing is expired', () => {
    let rentalListing;
    beforeEach(() => {
        rentalListing = { expiration: 0 };
    });
    describe('and the listing is not expired', () => {
        beforeEach(() => {
            rentalListing.expiration = Date.now() + 20000000;
        });
        it('should return false', () => {
            expect((0, rental_1.isExpired)(rentalListing)).toBe(false);
        });
    });
    describe('and the listing is expired', () => {
        beforeEach(() => {
            rentalListing.expiration = Date.now() - 20000000;
        });
        it('should return true', () => {
            expect((0, rental_1.isExpired)(rentalListing)).toBe(true);
        });
    });
});
