import { getTilesFilter, TilesFilter } from '../../src/logic/tiles-request'

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
