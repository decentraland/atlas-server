"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const legacy_tiles_1 = require("../../src/adapters/legacy-tiles");
const types_1 = require("../../src/modules/map/types");
describe('when converting tiles into a legacy tiles', () => {
    let tile;
    beforeEach(() => {
        tile = {
            id: 'anId',
            x: 1,
            y: 0,
            type: types_1.TileType.OWNED,
            top: true,
            topLeft: true,
            left: true,
            updatedAt: Date.now() / 1000,
        };
    });
    describe('and the tile contains a rental listing', () => {
        beforeEach(() => {
            tile.rentalListing = {
                expiration: Date.now(),
                periods: [
                    { minDays: 1, maxDays: 1, pricePerDay: '10000' },
                    { minDays: 2, maxDays: 2, pricePerDay: '20000' },
                ],
            };
        });
        it('should return the biggest price per day of the periods', () => {
            expect((0, legacy_tiles_1.toLegacyTiles)({ [tile.id]: tile })).toEqual({
                [tile.id]: expect.objectContaining({
                    rentalPricePerDay: '20000',
                }),
            });
        });
    });
    describe('and the tiles do not contain a rental listing', () => {
        it('should not have pricePerDays property', () => {
            expect((0, legacy_tiles_1.toLegacyTiles)({ [tile.id]: tile })).toEqual({
                [tile.id]: expect.not.objectContaining({
                    rentalPricePerDay: expect.anything(),
                }),
            });
        });
    });
});
