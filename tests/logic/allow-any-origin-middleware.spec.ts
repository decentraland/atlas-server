import { IHttpServerComponent } from '@dcl/core-commons'
import { allowAnyOriginMiddleware } from '../../src/logic/allow-any-origin-middleware'
import { Context } from '../../src/types'

describe('when handling a request with the allow any origin middleware', () => {
  let context: IHttpServerComponent.DefaultContext<Context<string>>
  let response: IHttpServerComponent.IResponse
  let next: jest.Mock
  let middleware: IHttpServerComponent.IRequestHandler<Context<string>>
  let result: IHttpServerComponent.IResponse

  beforeEach(() => {
    context = {
      request: { headers: new Headers() } as Request,
      components: {} as any,
      params: {},
      url: new URL('http://localhost'),
    }
    middleware = allowAnyOriginMiddleware()
  })

  describe('and the response has no Access-Control-Allow-Origin header', () => {
    beforeEach(async () => {
      response = {
        status: 200,
        headers: { 'Cache-Control': 'public' },
        body: 'ok',
      }
      next = jest.fn().mockResolvedValueOnce(response)
      result = await middleware(context, next)
    })

    it('should allow any origin', () => {
      expect(
        new Headers(result.headers).get('Access-Control-Allow-Origin')
      ).toBe('*')
    })

    it('should keep the rest of the response', () => {
      expect({
        status: result.status,
        body: result.body,
        cacheControl: new Headers(result.headers).get('Cache-Control'),
      }).toEqual({ status: 200, body: 'ok', cacheControl: 'public' })
    })
  })

  describe('and the response already has an Access-Control-Allow-Origin header', () => {
    beforeEach(async () => {
      response = {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': 'https://example.com' },
      }
      next = jest.fn().mockResolvedValueOnce(response)
      result = await middleware(context, next)
    })

    it('should keep the existing value', () => {
      expect(
        new Headers(result.headers).get('Access-Control-Allow-Origin')
      ).toBe('https://example.com')
    })
  })

  describe('and the handler returns a native Response', () => {
    beforeEach(async () => {
      next = jest
        .fn()
        .mockResolvedValueOnce(new Response('created', { status: 201 }))
      result = await middleware(context, next)
    })

    it('should keep the status and allow any origin', () => {
      expect({
        status: result.status,
        allowOrigin: new Headers(result.headers).get(
          'Access-Control-Allow-Origin'
        ),
      }).toEqual({ status: 201, allowOrigin: '*' })
    })

    it('should keep the body', async () => {
      const chunks: Buffer[] = []
      for await (const chunk of result.body as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk))
      }
      expect(Buffer.concat(chunks).toString()).toBe('created')
    })
  })
})
