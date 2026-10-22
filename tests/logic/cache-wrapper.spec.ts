import { cacheWrapper } from '../../src/logic/cache-wrapper'

type Response = { status: number; body: string }

describe('when calling a handler wrapped by the cache', () => {
  let handler: jest.Mock<Promise<Response>, [{ url: URL }]>
  let depValue: number
  let wrapped: (ctx: { url: URL }) => Promise<Response>
  let firstResponse: Response
  let secondResponse: Response

  beforeEach(() => {
    depValue = 1
    firstResponse = { status: 200, body: 'first' }
    secondResponse = { status: 200, body: 'second' }
    handler = jest.fn()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and a key function is given', () => {
    let responses: Response[]

    beforeEach(async () => {
      handler
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse)
      wrapped = cacheWrapper(handler, [() => depValue], {
        getKey: (url) => url.searchParams.get('x1') ?? '',
      })
      responses = [
        await wrapped({
          url: new URL('http://a.example/v2/tiles?x1=1&junk=1'),
        }),
        await wrapped({
          url: new URL('http://b.example/v2/tiles?x1=1&junk=2'),
        }),
      ]
    })

    it('should serve requests with the same key from the cache', () => {
      expect(responses).toEqual([firstResponse, firstResponse])
    })

    it('should call the handler once', () => {
      expect(handler).toHaveBeenCalledTimes(1)
    })
  })

  describe('and the dependencies change', () => {
    let response: Response

    beforeEach(async () => {
      handler
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse)
      wrapped = cacheWrapper(handler, [() => depValue])
      await wrapped({ url: new URL('http://a.example/v2/tiles') })
      depValue = 2
      response = await wrapped({ url: new URL('http://a.example/v2/tiles') })
    })

    it('should call the handler again and respond with the new response', () => {
      expect(response).toBe(secondResponse)
    })
  })

  describe('and the handler responds with a non 200 status', () => {
    let notReadyResponse: Response
    let response: Response

    beforeEach(async () => {
      notReadyResponse = { status: 503, body: 'Not ready' }
      handler
        .mockResolvedValueOnce(notReadyResponse)
        .mockResolvedValueOnce(firstResponse)
      wrapped = cacheWrapper(handler, [() => depValue])
      await wrapped({ url: new URL('http://a.example/v2/tiles') })
      response = await wrapped({ url: new URL('http://a.example/v2/tiles') })
    })

    it('should not cache it and respond with the next handler response', () => {
      expect(response).toBe(firstResponse)
    })
  })

  describe('and concurrent requests miss the cache with the same key', () => {
    let responses: Response[]

    beforeEach(async () => {
      handler.mockResolvedValueOnce(firstResponse)
      wrapped = cacheWrapper(handler, [() => depValue])
      responses = await Promise.all([
        wrapped({ url: new URL('http://a.example/v2/tiles') }),
        wrapped({ url: new URL('http://a.example/v2/tiles') }),
      ])
    })

    it('should share a single handler call', () => {
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('should respond to every request with the same response', () => {
      expect(responses).toEqual([firstResponse, firstResponse])
    })
  })

  describe('and the handler rejects', () => {
    let response: Response

    beforeEach(async () => {
      handler
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(firstResponse)
      wrapped = cacheWrapper(handler, [() => depValue])
      await wrapped({ url: new URL('http://a.example/v2/tiles') }).catch(
        () => undefined
      )
      response = await wrapped({ url: new URL('http://a.example/v2/tiles') })
    })

    it('should call the handler again on the next request', () => {
      expect(response).toBe(firstResponse)
    })
  })

  describe('and more keys than the maximum number of entries are requested', () => {
    let thirdResponse: Response

    beforeEach(async () => {
      thirdResponse = { status: 200, body: 'third' }
      handler
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse)
        .mockResolvedValueOnce(thirdResponse)
      wrapped = cacheWrapper(handler, [() => depValue], { maxEntries: 1 })
      await wrapped({ url: new URL('http://a.example/v2/tiles?x1=1') })
      await wrapped({ url: new URL('http://a.example/v2/tiles?x1=2') })
      await wrapped({ url: new URL('http://a.example/v2/tiles?x1=1') })
    })

    it('should evict the least recently used entries', () => {
      expect(handler).toHaveBeenCalledTimes(3)
    })
  })

  describe('and the cached bodies exceed the maximum body length', () => {
    beforeEach(async () => {
      handler
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse)
        .mockResolvedValueOnce(firstResponse)
        .mockResolvedValueOnce(secondResponse)
      wrapped = cacheWrapper(handler, [() => depValue], {
        maxBodyLength: firstResponse.body.length + 1,
      })
      await wrapped({ url: new URL('http://a.example/v2/tiles?x1=1') })
      await wrapped({ url: new URL('http://a.example/v2/tiles?x1=2') })
      await wrapped({ url: new URL('http://a.example/v2/tiles?x1=1') })
      await wrapped({ url: new URL('http://a.example/v2/tiles?x1=1') })
    })

    it('should evict entries to stay within the limit', () => {
      expect(handler).toHaveBeenCalledTimes(3)
    })
  })
})
