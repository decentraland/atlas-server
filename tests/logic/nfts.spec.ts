import {
  isNftIdFromEstate,
  isNftIdFromParcel,
  getTokenIdFromNftId,
  leftMerge,
} from '../../src/logic/nfts'

let nftId: string

describe('when checking if an NFT id belongs to a parcel', () => {
  describe("and the id doesn't start with parcel", () => {
    beforeEach(() => {
      nftId = 'estate-0x959e104e1a4db6317fa58f8295f586e1a978c297-1003'
    })

    it('should return false', () => {
      expect(isNftIdFromParcel(nftId)).toBe(false)
    })
  })

  describe('and the id starts with parcel', () => {
    beforeEach(() => {
      nftId =
        'parcel-0x25b6b4bac4adb582a0abd475439da6730777fbf7-3402823669209384634633746074317682114571'
    })

    it('should return true', () => {
      expect(isNftIdFromParcel(nftId)).toBe(true)
    })
  })
})

describe('when checking if an NFT id belongs to an estate', () => {
  let nftId: string

  describe("and the id doesn't start with estate", () => {
    beforeEach(() => {
      nftId =
        'parcel-0x25b6b4bac4adb582a0abd475439da6730777fbf7-3402823669209384634633746074317682114571'
    })

    it('should return false', () => {
      expect(isNftIdFromEstate(nftId)).toBe(false)
    })
  })

  describe('and the id starts with estate', () => {
    beforeEach(() => {
      nftId = 'estate-0x959e104e1a4db6317fa58f8295f586e1a978c297-1003'
    })

    it('should return true', () => {
      expect(isNftIdFromEstate(nftId)).toBe(true)
    })
  })
})

describe('when getting the token id from a nft id', () => {
  describe('and the nft id belongs to a parcel', () => {
    beforeEach(() => {
      nftId =
        'parcel-0x25b6b4bac4adb582a0abd475439da6730777fbf7-3402823669209384634633746074317682114571'
    })

    it('should return the token id', () => {
      expect(getTokenIdFromNftId(nftId)).toBe(
        '3402823669209384634633746074317682114571'
      )
    })
  })

  describe('and the nft id belongs to an estate', () => {
    beforeEach(() => {
      nftId = 'estate-0x959e104e1a4db6317fa58f8295f586e1a978c297-1003'
    })

    it('should return the token id', () => {
      expect(getTokenIdFromNftId(nftId)).toBe('1003')
    })
  })

  describe("and the nft id doesn't have a token id on them", () => {
    beforeEach(() => {
      nftId = 'some-id'
    })

    it('should return undefined', () => {
      expect(getTokenIdFromNftId(nftId)).toBe(undefined)
    })
  })
})

describe('when merging left an array of objects by id', () => {
  let leftArray: { id: string; letter?: string }[]
  let rightArray: { id: string; letter?: string }[]
  beforeEach(() => {
    leftArray = [{ id: '1' }, { id: '2', letter: 'A' }]
    rightArray = [{ id: '2', letter: 'B' }, { id: '3' }]
  })

  it("should return an array without duplicated by overwriting the objects with the right arrays' content", () => {
    const mergeResult = leftMerge(leftArray, rightArray)

    expect(mergeResult).toEqual(
      expect.arrayContaining([leftArray[0], rightArray[0], rightArray[1]])
    )
    expect(mergeResult.length).toBe(3)
  })
})
