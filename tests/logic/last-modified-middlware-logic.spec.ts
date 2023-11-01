import { IHttpServerComponent } from '@well-known-components/interfaces'
import { lastModifiedMiddleware } from '../../src/logic/last-modified-middleware'
import { Headers, Request } from 'node-fetch'
import { Context } from '../../src/types'

let mockedResponse: IHttpServerComponent.IResponse
let mockedRequest: IHttpServerComponent.IRequest
let mockedContext: IHttpServerComponent.DefaultContext<Context<string>>
let mockedGetLastModifiedTime: () => number
let lastModifiedUTSCString: string
let middleware: ReturnType<typeof lastModifiedMiddleware>

beforeEach(() => {
  mockedResponse = {}
  mockedRequest = { headers: new Headers() } as Request
  mockedContext = {
    request: mockedRequest,
    components: {} as any,
    params: {},
    url: new URL('http://localhost'),
  }
  mockedGetLastModifiedTime = () => Date.parse(lastModifiedUTSCString)
  middleware = lastModifiedMiddleware(mockedGetLastModifiedTime)
})

describe('when handling a request with a If-Modified-Since header', () => {
  describe('when the If-Modified-Since header is a valid date', () => {
    beforeEach(() => {
      mockedRequest.headers.set(
        'If-Modified-Since',
        'Tue, 20 Jan 1970 11:55:03 GMT'
      )
    })

    describe('when the If-Modified-Since header is before the last modified time', () => {
      beforeEach(() => {
        lastModifiedUTSCString = 'Tue, 20 Jan 1970 15:00:03 GMT'
      })

      it("should return a 200 OK response with the next handlers's data, the Last-Modified and the Cache-Control headers", () => {
        return expect(
          middleware(mockedContext, () => Promise.resolve(mockedResponse))
        ).resolves.toEqual({
          ...mockedResponse,
          headers: {
            'Last-Modified': lastModifiedUTSCString,
            'Cache-Control': 'max-age=120, stale-while-revalidate=180, public',
          },
        })
      })
    })

    describe('when the If-Modified-Since header is the same as last modified time', () => {
      beforeEach(() => {
        lastModifiedUTSCString = 'Tue, 20 Jan 1970 11:55:03 GMT'
        mockedResponse = { status: 200, body: 'ok' }
      })

      it('should return a 304 Not Modified response', () => {
        return expect(
          middleware(mockedContext, () => Promise.resolve(mockedResponse))
        ).resolves.toEqual({
          status: 304,
          headers: {
            'Last-Modified': lastModifiedUTSCString,
            'Cache-Control': 'max-age=120, stale-while-revalidate=180, public',
          },
        })
      })
    })

    describe('when the If-Modified-Since header is after the last modified time', () => {
      beforeEach(() => {
        lastModifiedUTSCString = 'Tue, 20 Jan 1970 11:10:03 GMT'
        mockedResponse = { status: 200, body: 'ok' }
      })

      it('should return a 304 Not Modified response', () => {
        return expect(
          middleware(mockedContext, () => Promise.resolve(mockedResponse))
        ).resolves.toEqual({
          status: 304,
          headers: {
            'Last-Modified': lastModifiedUTSCString,
            'Cache-Control': 'max-age=120, stale-while-revalidate=180, public',
          },
        })
      })
    })
  })

  describe('when the If-Modified-Since header is not a valid date', () => {
    beforeEach(() => {
      mockedRequest.headers.set('If-Modified-Since', 'Something wrong')
      mockedResponse = { status: 200, body: 'ok' }
      lastModifiedUTSCString = 'Sun, 25 Jan 1970 10:00:03 GMT'
    })

    it("should return a 200 OK response with the next handlers's data, the Last-Modified and the Cache-Control headers", () => {
      return expect(
        middleware(mockedContext, () => Promise.resolve(mockedResponse))
      ).resolves.toEqual({
        ...mockedResponse,
        headers: {
          'Last-Modified': lastModifiedUTSCString,
          'Cache-Control': 'max-age=120, stale-while-revalidate=180, public',
        },
      })
    })
  })
})

describe('when handling a request without a If-Modified-Since header', () => {
  beforeEach(() => {
    lastModifiedUTSCString = 'Sun, 25 Jan 1970 10:00:03 GMT'
    mockedResponse = { status: 200, body: 'ok' }
  })

  it("should return a 200 OK response with the next handlers's data, the Last-Modified and the Cache-Control headers", () => {
    return expect(
      middleware(mockedContext, () => Promise.resolve(mockedResponse))
    ).resolves.toEqual({
      ...mockedResponse,
      headers: {
        'Last-Modified': lastModifiedUTSCString,
        'Cache-Control': 'max-age=120, stale-while-revalidate=180, public',
      },
    })
  })
})

describe('when setting the max age and the stale while revalidate options', () => {
  beforeEach(() => {
    lastModifiedUTSCString = 'Sun, 25 Jan 1970 10:00:03 GMT'
    mockedResponse = { status: 200, body: 'ok' }
    middleware = lastModifiedMiddleware(mockedGetLastModifiedTime, {
      maxAge: 600,
      staleWhileRevalidate: 600,
    })
  })

  it('should return a response with the Last-Modified and the Cache-Control headers set as in the options', () => {
    return expect(
      middleware(mockedContext, () => Promise.resolve(mockedResponse))
    ).resolves.toEqual({
      ...mockedResponse,
      headers: {
        'Last-Modified': lastModifiedUTSCString,
        'Cache-Control': 'max-age=600, stale-while-revalidate=600, public',
      },
    })
  })
})
