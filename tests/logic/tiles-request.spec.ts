import {
  getMapBounds,
  getTilesFilter,
  MapBounds,
  TilesFilter,
} from '../../src/logic/tiles-request'

describe('when getting the tiles filter of a request', () => {
  let filter: TilesFilter

  describe.each([
    ['no params', ''],
    ['only some of the coordinates', '?x1=1&y1=2&x2=3'],
    ['a non numeric coordinate', '?x1=1&y1=2&x2=3&y2=abc'],
    ['an empty coordinate', '?x1=1&y1=2&x2=3&y2='],
    ['include without valid fields', '?include=junk,,other'],
    ['exclude without valid fields', '?exclude=junk'],
    ['unrelated params', '?foo=bar&cache-buster=123'],
  ])('and the request has %s', (_name, search) => {
    beforeEach(() => {
      filter = getTilesFilter(new URL(`http://localhost/v2/tiles${search}`))
    })

    it('should not be filtered and have no params', () => {
      expect({
        isFiltered: filter.isFiltered,
        search: filter.url.search,
      }).toEqual({ isFiltered: false, search: '' })
    })
  })

  describe.each([
    [
      'all four numeric coordinates out of order',
      '?x1=3&y1=4&x2=-1&y2=0&foo=bar',
      '?x1=-1&y1=0&x2=3&y2=4',
    ],
    [
      'include with valid and invalid fields',
      '?include=owner,junk,x,owner',
      '?include=owner%2Cx',
    ],
    ['exclude with a valid field', '?exclude=owner,junk', '?exclude=owner'],
    ['both include and exclude', '?include=x&exclude=owner', '?include=x'],
  ])('and the request has %s', (_name, search, expectedSearch) => {
    beforeEach(() => {
      filter = getTilesFilter(new URL(`http://localhost/v2/tiles${search}`))
    })

    it('should be filtered with only the normalized params that apply', () => {
      expect({
        isFiltered: filter.isFiltered,
        search: filter.url.search,
      }).toEqual({ isFiltered: true, search: expectedSearch })
    })
  })
})

describe('when getting the tiles filter of a request within the map bounds', () => {
  let bounds: MapBounds
  let filter: TilesFilter

  beforeEach(() => {
    bounds = { minX: -150, minY: -150, maxX: 150, maxY: 150 }
  })

  describe.each([
    [
      'a box that covers exactly the whole map',
      '?x1=-150&y1=-150&x2=150&y2=150',
    ],
    ['a box larger than the whole map', '?x1=-151&y1=-999&x2=150&y2=200'],
  ])('and the request has %s', (_name, search) => {
    beforeEach(() => {
      filter = getTilesFilter(
        new URL(`http://localhost/v2/tiles${search}`),
        bounds
      )
    })

    it('should not be filtered and have no params', () => {
      expect({
        isFiltered: filter.isFiltered,
        search: filter.url.search,
      }).toEqual({ isFiltered: false, search: '' })
    })
  })

  describe.each([
    [
      'a box that crosses the map edge',
      '?x1=140&y1=-200&x2=170&y2=-140',
      '?x1=140&y1=-150&x2=150&y2=-140',
    ],
    [
      'a box entirely outside the map',
      '?x1=200&y1=200&x2=300&y2=300',
      '?x1=151&y1=151&x2=151&y2=151',
    ],
    [
      'another box entirely outside the map',
      '?x1=-500&y1=0&x2=-400&y2=10',
      '?x1=151&y1=151&x2=151&y2=151',
    ],
  ])('and the request has %s', (_name, search, expectedSearch) => {
    beforeEach(() => {
      filter = getTilesFilter(
        new URL(`http://localhost/v2/tiles${search}`),
        bounds
      )
    })

    it('should be filtered with the coordinates clamped to the map', () => {
      expect({
        isFiltered: filter.isFiltered,
        search: filter.url.search,
      }).toEqual({ isFiltered: true, search: expectedSearch })
    })
  })
})

describe('when getting the bounds of the map', () => {
  let result: MapBounds | null

  describe('and there are tiles', () => {
    beforeEach(() => {
      result = getMapBounds([
        { x: 3, y: -2 },
        { x: -7, y: 4 },
        { x: 0, y: 9 },
      ])
    })

    it('should respond with the smallest box that holds every tile', () => {
      expect(result).toEqual({ minX: -7, minY: -2, maxX: 3, maxY: 9 })
    })
  })

  describe('and there are no tiles', () => {
    beforeEach(() => {
      result = getMapBounds([])
    })

    it('should respond with null', () => {
      expect(result).toBeNull()
    })
  })
})
