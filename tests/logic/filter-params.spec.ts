import { InvalidRequestError } from '../../src/logic/error'
import {
  extractParams,
  getFilterFromUrl,
  parseCoordinate,
} from '../../src/logic/filter-params'
import { Tile, TileType } from '../../src/modules/map/types'

describe('when filtering the tiles from the url', () => {
  let tiles: Record<string, Tile>
  let url: URL

  beforeEach(() => {
    tiles = {
      '0,0': {
        id: '0,0',
        x: 0,
        y: 0,
        type: TileType.OWNED,
        top: false,
        left: false,
        topLeft: false,
        updatedAt: 1,
        name: 'A parcel',
        owner: '0xowner',
      },
    }
  })

  describe('and only the exclude param is set', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v2/tiles?exclude=owner,name')
    })

    it('should drop the excluded fields from every tile', () => {
      expect(Object.keys(getFilterFromUrl(url, tiles)['0,0'])).toEqual(
        expect.not.arrayContaining(['owner', 'name'])
      )
    })

    it('should keep the fields that were not excluded', () => {
      expect(getFilterFromUrl(url, tiles)['0,0']).toEqual(
        expect.objectContaining({ id: '0,0', x: 0, y: 0 })
      )
    })
  })
})

describe('when parsing a coordinate', () => {
  let value: string

  describe('and it is a signed integer', () => {
    beforeEach(() => {
      value = '-23'
    })

    it('should return its numeric value', () => {
      expect(parseCoordinate(value, 'x')).toBe(-23)
    })
  })

  describe('and it has leading zeros', () => {
    beforeEach(() => {
      value = '01'
    })

    it('should return the same value as without them', () => {
      expect(parseCoordinate(value, 'x')).toBe(1)
    })
  })

  describe.each([
    'abc',
    '1abc',
    '1.5',
    '',
    ' 1',
    '1e3',
    '99999999999999999999',
  ])('and it is %p', (invalid) => {
    beforeEach(() => {
      value = invalid
    })

    it('should throw an invalid request error', () => {
      expect(() => parseCoordinate(value, 'x')).toThrow(InvalidRequestError)
    })
  })
})

describe('when extracting the image params from the url', () => {
  let url: URL

  describe('and no params are set', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v1/map.png')
    })

    it('should return the defaults', () => {
      expect(extractParams(url)).toEqual({
        width: 1024,
        height: 1024,
        size: 20,
        center: { x: 0, y: 0 },
        showOnSale: false,
        showListedForRent: false,
        selected: [],
      })
    })
  })

  describe.each([
    [
      'the unity explorer chunks',
      'width=1020&height=1020&size=20&center=-150,150',
    ],
    ['the bevy explorer chunks', 'width=768&height=768&size=16&center=8,-24'],
    ['the estate token images', 'width=1024&height=1024&size=24'],
    ['the largest allowed image', 'width=2048&height=2048&size=11'],
  ])('and the params are the ones of %s', (_, query) => {
    beforeEach(() => {
      url = new URL(`http://localhost/v1/map.png?${query}`)
    })

    it('should accept them', () => {
      expect(() => extractParams(url)).not.toThrow()
    })
  })

  describe('and the image has more pixels than the budget', () => {
    beforeEach(() => {
      url = new URL(
        'http://localhost/v1/map.png?width=4096&height=4096&size=50'
      )
    })

    it('should throw an invalid request error explaining the pixel limit', () => {
      expect(() => extractParams(url)).toThrow(
        new InvalidRequestError(
          'Image too large: width * height must be at most 4194304 pixels'
        )
      )
    })
  })

  describe('and the image has more tiles than the budget', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v1/map.png?width=2048&height=2048&size=5')
    })

    it('should throw an invalid request error explaining the tile limit', () => {
      expect(() => extractParams(url)).toThrow(
        new InvalidRequestError(
          'Too many tiles: (width / size) * (height / size) must be at most 40000'
        )
      )
    })
  })

  describe('and the center is not a pair of integers', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v1/map.png?center=foo')
    })

    it('should throw an invalid request error', () => {
      expect(() => extractParams(url)).toThrow(InvalidRequestError)
    })
  })

  describe('and a selected coordinate is not an integer', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v1/map.png?selected=1,1;a,2')
    })

    it('should throw an invalid request error', () => {
      expect(() => extractParams(url)).toThrow(InvalidRequestError)
    })
  })

  describe('and the selected coordinates have a trailing separator', () => {
    beforeEach(() => {
      url = new URL('http://localhost/v1/map.png?selected=1,1;-2,3;')
    })

    it('should return the selected coordinates', () => {
      expect(extractParams(url).selected).toEqual([
        { x: 1, y: 1 },
        { x: -2, y: 3 },
      ])
    })
  })
})
