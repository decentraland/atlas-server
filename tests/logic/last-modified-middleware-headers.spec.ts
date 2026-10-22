import { IHttpServerComponent } from '@dcl/core-commons'
import { lastModifiedMiddleware } from '../../src/logic/last-modified-middleware'
import { Context } from '../../src/types'

const LAST_MODIFIED = 'Tue, 20 Jan 1970 15:00:03 GMT'
const DEFAULT_CACHE_CONTROL =
  'max-age=120, s-maxage=120, stale-while-revalidate=180, public'

describe('when the last modified middleware decorates a response', () => {
  let context: IHttpServerComponent.DefaultContext<Context<string>>
  let middleware: ReturnType<typeof lastModifiedMiddleware>
  let response: IHttpServerComponent.IResponse
  let result: IHttpServerComponent.IResponse

  beforeEach(() => {
    context = {
      request: { headers: new Headers() } as Request,
      components: {} as any,
      params: {},
      url: new URL('http://localhost'),
    }
    middleware = lastModifiedMiddleware(() => Date.parse(LAST_MODIFIED))
  })

  describe.each([301, 302, 404])(
    'and the response has a %p status',
    (status) => {
      beforeEach(async () => {
        response = { status, headers: { location: '/elsewhere' } }
        result = await middleware(context, () => Promise.resolve(response))
      })

      it('should add a short public cache and no Last-Modified header', () => {
        expect(result.headers).toEqual({
          location: '/elsewhere',
          'Cache-Control': 'max-age=60, s-maxage=60, public',
        })
      })
    }
  )

  describe('and a redirect already has a cache-control header', () => {
    beforeEach(async () => {
      response = {
        status: 301,
        headers: {
          location: '/elsewhere',
          'cache-control': 'public, max-age=600',
        },
      }
      result = await middleware(context, () => Promise.resolve(response))
    })

    it('should keep it as the only cache control header', () => {
      expect(result.headers).toEqual({
        location: '/elsewhere',
        'cache-control': 'public, max-age=600',
      })
    })
  })

  describe.each([400, 500, 503])(
    'and the response has a %p status',
    (status) => {
      beforeEach(async () => {
        response = { status, body: 'error' }
        result = await middleware(context, () => Promise.resolve(response))
      })

      it('should return the response without caching headers', () => {
        expect(result).toEqual({ status, body: 'error' })
      })
    }
  )

  describe('and the response already has a lowercase cache-control header', () => {
    beforeEach(async () => {
      response = {
        status: 200,
        headers: { 'cache-control': 'public, max-age=3600, immutable' },
        body: 'ok',
      }
      result = await middleware(context, () => Promise.resolve(response))
    })

    it('should keep it as the only cache control header and add the Last-Modified header', () => {
      expect(result.headers).toEqual({
        'cache-control': 'public, max-age=3600, immutable',
        'Last-Modified': LAST_MODIFIED,
      })
    })
  })

  describe('and the response has its headers as a Headers instance', () => {
    beforeEach(async () => {
      response = {
        status: 200,
        headers: new Headers({ 'Content-Type': 'image/png' }),
        body: 'ok',
      }
      result = await middleware(context, () => Promise.resolve(response))
    })

    it('should keep them and add the caching headers', () => {
      expect(result.headers).toEqual({
        'content-type': 'image/png',
        'Last-Modified': LAST_MODIFIED,
        'Cache-Control': DEFAULT_CACHE_CONTROL,
      })
    })
  })
})
