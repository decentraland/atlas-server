"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const error_1 = require("../../src/logic/error");
describe('when checking if the error has a message but the error is undefined', () => {
    it('should return false', () => {
        expect((0, error_1.isErrorWithMessage)(undefined)).toBe(false);
    });
});
describe('when checking if the error has a message but the error is null', () => {
    it('should return false', () => {
        expect((0, error_1.isErrorWithMessage)(null)).toBe(false);
    });
});
describe("when checking if the error has a message and the error is an object but it doesn't contain a message", () => {
    it('should return false', () => {
        expect((0, error_1.isErrorWithMessage)({})).toBe(false);
    });
});
describe('when checking if the error has a message and the error is an object but it contains a message', () => {
    it('should return true', () => {
        expect((0, error_1.isErrorWithMessage)({ message: 'An error occurred' })).toBe(true);
    });
});
