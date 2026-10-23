import {
  IConfigComponent,
  IMetricsComponent,
} from '@well-known-components/interfaces'
import {
  createImageCache,
  createImageCacheComponent,
  IImageCacheComponent,
  ImageRequest,
} from '../../src/adapters/image-cache'
import { RenderAbortedError } from '../../src/adapters/render-pool'
import { Metrics } from '../../src/metrics'

type Deferred = {
  promise: Promise<Buffer>
  resolve: (png: Buffer) => void
  reject: (error: Error) => void
}

function defer(): Deferred {
  let resolve!: (png: Buffer) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Buffer>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// "land:1000:" and a sha256 in hex
const KEY_BYTES = 10 + 64
const PNG_BYTES = 6
const ENTRY_BYTES = KEY_BYTES + PNG_BYTES

describe('when serving images through the image cache', () => {
  let cache: IImageCacheComponent
  let increment: jest.Mock
  let observe: jest.Mock
  let render: jest.Mock
  let request: ImageRequest
  let png: Buffer
  let maxBytes: number

  function createCache() {
    cache = createImageCache(
      {
        metrics: { increment, observe } as unknown as IMetricsComponent<
          keyof Metrics
        >,
      },
      { maxBytes }
    )
  }

  beforeEach(() => {
    increment = jest.fn()
    observe = jest.fn()
    png = Buffer.alloc(PNG_BYTES, 1)
    render = jest.fn().mockResolvedValue(png)
    request = { kind: 'map', key: 'a', scope: 'land', version: '1000' }
    // two entries fit
    maxBytes = ENTRY_BYTES * 2 + 20
    createCache()
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and the image was rendered before for the same version', () => {
    let result: Buffer

    beforeEach(async () => {
      await cache.getOrRender(request, render)
      result = await cache.getOrRender({ ...request }, render)
    })

    it('should render it only once', () => {
      expect(render).toHaveBeenCalledTimes(1)
    })

    it('should return the rendered PNG', () => {
      expect(result).toBe(png)
    })

    it('should count a miss and then a hit', () => {
      expect(increment.mock.calls).toEqual([
        ['dcl_map_image_cache_total', { kind: 'map', result: 'miss' }],
        ['dcl_map_image_cache_total', { kind: 'map', result: 'hit' }],
      ])
    })

    it('should report the bytes held, key included', () => {
      expect(observe).toHaveBeenLastCalledWith(
        'dcl_map_image_cache_bytes',
        {},
        ENTRY_BYTES
      )
    })
  })

  describe('and the same key is requested for another image kind', () => {
    beforeEach(async () => {
      await cache.getOrRender(request, render)
      await cache.getOrRender({ ...request, kind: 'parcel' }, render)
    })

    it('should render each image', () => {
      expect(render).toHaveBeenCalledTimes(2)
    })
  })

  describe('and the version changes', () => {
    beforeEach(async () => {
      await cache.getOrRender(request, render)
      await cache.getOrRender({ ...request, version: '2000' }, render)
    })

    it('should render the image again', () => {
      expect(render).toHaveBeenCalledTimes(2)
    })

    it('should drop the images of the previous version', () => {
      expect(observe.mock.calls.map(([, , bytes]) => bytes)).toEqual([
        ENTRY_BYTES,
        0,
        ENTRY_BYTES,
      ])
    })
  })

  describe('and the version of another scope changes', () => {
    beforeEach(async () => {
      await cache.getOrRender(request, render)
      await cache.getOrRender(
        { ...request, key: 'b', scope: 'overlay', version: 'aaaa' },
        render
      )
      await cache.getOrRender(
        { ...request, key: 'b', scope: 'overlay', version: 'bbbb' },
        render
      )
      await cache.getOrRender(request, render)
    })

    it('should keep the images of the unchanged scope', () => {
      expect(render).toHaveBeenCalledTimes(3)
    })
  })

  describe('and a render of a replaced version finishes after the version changed', () => {
    let pending: Deferred

    beforeEach(async () => {
      pending = defer()
      render.mockReturnValueOnce(pending.promise)
      const old = cache.getOrRender(request, render)
      await cache.getOrRender({ ...request, key: 'b', version: '2000' }, render)
      pending.resolve(png)
      await old
      await cache.getOrRender({ ...request, version: '2000' }, render)
    })

    it('should not keep it', () => {
      expect(render).toHaveBeenCalledTimes(3)
    })
  })

  describe('and the images exceed the byte budget', () => {
    beforeEach(async () => {
      await cache.getOrRender(request, render)
      await cache.getOrRender({ ...request, key: 'b' }, render)
      await cache.getOrRender({ ...request, key: 'c' }, render)
      await cache.getOrRender(request, render)
    })

    it('should evict the least recently used image and render it again', () => {
      expect(render).toHaveBeenCalledTimes(4)
    })
  })

  describe('and many images with very long keys are requested', () => {
    let sizes: number[]

    beforeEach(async () => {
      for (let i = 0; i < 1000; i++) {
        await cache.getOrRender(
          { ...request, key: `${i}|${'1,1;'.repeat(4000)}` },
          render
        )
      }
      sizes = observe.mock.calls.map(([, , bytes]) => bytes)
    })

    it('should keep the bytes held within the budget', () => {
      expect(Math.max(...sizes)).toBeLessThanOrEqual(maxBytes)
    })
  })

  describe('and the same image is requested again while it renders', () => {
    let results: Buffer[]

    beforeEach(async () => {
      results = await Promise.all([
        cache.getOrRender(request, render),
        cache.getOrRender({ ...request }, render),
      ])
    })

    it('should render it once', () => {
      expect(render).toHaveBeenCalledTimes(1)
    })

    it('should return the PNG to both requests', () => {
      expect(results).toEqual([png, png])
    })

    it('should count the second request as shared', () => {
      expect(increment).toHaveBeenLastCalledWith('dcl_map_image_cache_total', {
        kind: 'map',
        result: 'shared',
      })
    })
  })

  describe('and the budget is 0', () => {
    let pending: Deferred
    let results: Buffer[]

    beforeEach(async () => {
      maxBytes = 0
      createCache()
      pending = defer()
      render.mockReturnValueOnce(pending.promise)
      const concurrent = Promise.all([
        cache.getOrRender(request, render),
        cache.getOrRender(request, render),
      ])
      pending.resolve(png)
      results = await concurrent
      await cache.getOrRender(request, render)
    })

    it('should share concurrent renders but keep nothing', () => {
      expect({ results, renders: render.mock.calls.length }).toEqual({
        results: [png, png],
        renders: 2,
      })
    })
  })

  describe('and the render fails', () => {
    let error: unknown

    beforeEach(async () => {
      render.mockRejectedValueOnce(new Error('Canvas failure'))
      error = await cache.getOrRender(request, render).catch((e) => e)
      await cache.getOrRender(request, render)
    })

    it('should reject with the render error', () => {
      expect(error).toEqual(new Error('Canvas failure'))
    })

    it('should not keep the failure, rendering on the next request', () => {
      expect(render).toHaveBeenCalledTimes(2)
    })
  })

  describe('and one of two requests sharing a render is aborted', () => {
    let pending: Deferred
    let controller: AbortController
    let aborted: Promise<unknown>
    let remaining: Promise<Buffer>
    let renderSignal: AbortSignal

    beforeEach(async () => {
      pending = defer()
      render.mockImplementationOnce((signal: AbortSignal) => {
        renderSignal = signal
        return pending.promise
      })
      controller = new AbortController()
      aborted = cache
        .getOrRender({ ...request, signal: controller.signal }, render)
        .catch((e) => e)
      remaining = cache.getOrRender(
        { ...request, signal: new AbortController().signal },
        render
      )
      controller.abort()
      await aborted
    })

    afterEach(async () => {
      pending.resolve(png)
      await remaining
    })

    it('should reject the aborted request', async () => {
      expect(await aborted).toBeInstanceOf(RenderAbortedError)
    })

    it('should keep the shared render running for the other request', () => {
      expect(renderSignal.aborted).toBe(false)
    })
  })

  describe('and a request without a signal shares a render with an aborted one', () => {
    let pending: Deferred
    let controller: AbortController
    let renderSignal: AbortSignal
    let remaining: Promise<Buffer>

    beforeEach(async () => {
      pending = defer()
      render.mockImplementationOnce((signal: AbortSignal) => {
        renderSignal = signal
        return pending.promise
      })
      controller = new AbortController()
      const aborted = cache
        .getOrRender({ ...request, signal: controller.signal }, render)
        .catch(() => undefined)
      remaining = cache.getOrRender(request, render)
      controller.abort()
      await aborted
    })

    afterEach(async () => {
      pending.resolve(png)
      await remaining
    })

    it('should keep the shared render running', () => {
      expect(renderSignal.aborted).toBe(false)
    })
  })

  describe('and every request waiting for a render is aborted', () => {
    let pending: Deferred
    let controller: AbortController
    let renderSignal: AbortSignal

    beforeEach(async () => {
      pending = defer()
      render.mockImplementationOnce((signal: AbortSignal) => {
        renderSignal = signal
        return pending.promise
      })
      controller = new AbortController()
      const aborted = cache
        .getOrRender({ ...request, signal: controller.signal }, render)
        .catch(() => undefined)
      controller.abort()
      await aborted
    })

    afterEach(() => {
      pending.resolve(png)
    })

    it('should abort the render', () => {
      expect(renderSignal.aborted).toBe(true)
    })

    describe('and the image is requested again while the abandoned render is on a thread', () => {
      let result: Promise<Buffer>

      beforeEach(async () => {
        result = cache.getOrRender(request, render)
        pending.resolve(png)
        await result
        await cache.getOrRender(request, render)
      })

      it('should join it instead of rendering again, and keep its PNG', async () => {
        expect({
          result: await result,
          renders: render.mock.calls.length,
        }).toEqual({ result: png, renders: 1 })
      })
    })

    describe('and the image is requested again after the abandoned render was stopped before a thread', () => {
      let result: Buffer

      beforeEach(async () => {
        const next = cache.getOrRender(request, render)
        pending.reject(new RenderAbortedError('The request was aborted'))
        result = await next
      })

      it('should render it again for the new request', () => {
        expect({ result, renders: render.mock.calls.length }).toEqual({
          result: png,
          renders: 2,
        })
      })
    })
  })

  describe('and the request was aborted before it asked for the image', () => {
    let controller: AbortController
    let error: unknown

    beforeEach(async () => {
      controller = new AbortController()
      controller.abort()
      error = await cache
        .getOrRender({ ...request, signal: controller.signal }, render)
        .catch((e) => e)
    })

    it('should reject with a RenderAbortedError', () => {
      expect(error).toBeInstanceOf(RenderAbortedError)
    })

    it('should abort the render it started', () => {
      expect(render.mock.calls[0][0].aborted).toBe(true)
    })
  })

  describe.each(['not_modified', 'dissolved'] as const)(
    'and a %s answer is recorded',
    (result) => {
      beforeEach(() => {
        cache.record('estate', result)
      })

      it('should count it with its result', () => {
        expect(increment).toHaveBeenCalledWith('dcl_map_image_cache_total', {
          kind: 'estate',
          result,
        })
      })
    }
  )
})

describe('when creating the image cache from config', () => {
  let getString: jest.Mock
  let warn: jest.Mock
  let render: jest.Mock
  let cache: IImageCacheComponent

  beforeEach(() => {
    getString = jest.fn()
    warn = jest.fn()
    render = jest.fn().mockResolvedValue(Buffer.alloc(PNG_BYTES))
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  async function create() {
    return createImageCacheComponent({
      config: { getString } as unknown as IConfigComponent,
      logs: {
        getLogger: () => ({
          warn,
          info: jest.fn(),
          error: jest.fn(),
          debug: jest.fn(),
          log: jest.fn(),
        }),
      },
      metrics: {
        increment: jest.fn(),
        observe: jest.fn(),
      } as unknown as IMetricsComponent<keyof Metrics>,
    })
  }

  async function requestTwiceWithAnotherImageBetween() {
    const request: ImageRequest = {
      kind: 'map',
      key: 'a',
      scope: 'land',
      version: '1000',
    }
    await cache.getOrRender(request, render)
    await cache.getOrRender({ ...request, key: 'b' }, render)
    await cache.getOrRender(request, render)
  }

  describe('and IMAGE_CACHE_MAX_BYTES fits a single image', () => {
    beforeEach(async () => {
      getString.mockResolvedValueOnce(String(ENTRY_BYTES))
      cache = await create()
      await requestTwiceWithAnotherImageBetween()
    })

    it('should bound the cache by it', () => {
      expect(render).toHaveBeenCalledTimes(3)
    })
  })

  describe.each([
    ['not set', undefined],
    ['empty', ''],
  ])('and IMAGE_CACHE_MAX_BYTES is %s', (_name, value) => {
    beforeEach(async () => {
      getString.mockResolvedValueOnce(value)
      cache = await create()
      await requestTwiceWithAnotherImageBetween()
    })

    it('should use the default budget without warning', () => {
      expect({
        renders: render.mock.calls.length,
        warnings: warn.mock.calls,
      }).toEqual({ renders: 2, warnings: [] })
    })
  })

  describe('and IMAGE_CACHE_MAX_BYTES is 0', () => {
    beforeEach(async () => {
      getString.mockResolvedValueOnce('0')
      cache = await create()
      await requestTwiceWithAnotherImageBetween()
    })

    it('should keep nothing', () => {
      expect(render).toHaveBeenCalledTimes(3)
    })
  })

  describe.each(['64MB', '1e6', '12.5', '-1', '0x10', '99999999999999999999'])(
    'and IMAGE_CACHE_MAX_BYTES is %p',
    (value) => {
      beforeEach(async () => {
        getString.mockResolvedValueOnce(value)
        cache = await create()
        await requestTwiceWithAnotherImageBetween()
      })

      it('should warn and use the default', () => {
        expect({
          renders: render.mock.calls.length,
          warnings: warn.mock.calls,
        }).toEqual({
          renders: 2,
          warnings: [
            [
              'Invalid IMAGE_CACHE_MAX_BYTES, using the default',
              { value, defaultValue: 64 * 1024 * 1024 },
            ],
          ],
        })
      })
    }
  )
})
