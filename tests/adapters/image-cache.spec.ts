import { IMetricsComponent } from '@well-known-components/interfaces'
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

describe('when serving images through the image cache', () => {
  let cache: IImageCacheComponent
  let increment: jest.Mock
  let observe: jest.Mock
  let render: jest.Mock
  let request: ImageRequest
  let png: Buffer

  beforeEach(() => {
    increment = jest.fn()
    observe = jest.fn()
    png = Buffer.alloc(6, 1)
    render = jest.fn().mockResolvedValue(png)
    request = { kind: 'map', key: 'a', version: 1000 }
    cache = createImageCache(
      {
        metrics: { increment, observe } as unknown as IMetricsComponent<
          keyof Metrics
        >,
      },
      { maxBytes: 10 }
    )
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  describe('and the image was rendered before for the same map version', () => {
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

    it('should report the bytes held', () => {
      expect(observe).toHaveBeenLastCalledWith(
        'dcl_map_image_cache_bytes',
        {},
        6
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

  describe('and the map version changes', () => {
    beforeEach(async () => {
      await cache.getOrRender(request, render)
      await cache.getOrRender({ ...request, version: 2000 }, render)
    })

    it('should render the image again', () => {
      expect(render).toHaveBeenCalledTimes(2)
    })

    it('should drop the images of the previous version', () => {
      expect(observe.mock.calls.map(([, , bytes]) => bytes)).toEqual([
        0, 6, 0, 6,
      ])
    })
  })

  describe('and a render of an older map version finishes after the version changed', () => {
    let pending: Deferred

    beforeEach(async () => {
      pending = defer()
      render.mockReturnValueOnce(pending.promise)
      const old = cache.getOrRender(request, render)
      await cache.getOrRender({ ...request, key: 'b', version: 2000 }, render)
      pending.resolve(png)
      await old
      await cache.getOrRender(request, render)
    })

    it('should not keep it, rendering it again', () => {
      expect(render).toHaveBeenCalledTimes(3)
    })
  })

  describe('and the images exceed the byte budget', () => {
    beforeEach(async () => {
      await cache.getOrRender(request, render)
      await cache.getOrRender({ ...request, key: 'b' }, render)
      await cache.getOrRender(request, render)
    })

    it('should evict the least recently used image and render it again', () => {
      expect(render).toHaveBeenCalledTimes(3)
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
    let result: Buffer

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
      result = await cache.getOrRender(request, render)
      pending.reject(new RenderAbortedError('The request was aborted'))
    })

    it('should abort the render', () => {
      expect(renderSignal.aborted).toBe(true)
    })

    it('should start a new render for the next request', () => {
      expect({ renders: render.mock.calls.length, result }).toEqual({
        renders: 2,
        result: png,
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

  describe('and a 304 is recorded', () => {
    beforeEach(() => {
      cache.recordNotModified('minimap')
    })

    it('should count it as not modified', () => {
      expect(increment).toHaveBeenCalledWith('dcl_map_image_cache_total', {
        kind: 'minimap',
        result: 'not_modified',
      })
    })
  })
})

describe('when creating the image cache from config', () => {
  let getString: jest.Mock
  let warn: jest.Mock
  let render: jest.Mock
  let cache: IImageCacheComponent

  beforeEach(() => {
    getString = jest.fn()
    warn = jest.fn()
    render = jest.fn().mockResolvedValue(Buffer.alloc(6))
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  async function create() {
    return createImageCacheComponent({
      config: { getString } as never,
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

  describe('and IMAGE_CACHE_MAX_BYTES is set', () => {
    beforeEach(async () => {
      getString.mockResolvedValueOnce('10')
      cache = await create()
      await cache.getOrRender({ kind: 'map', key: 'a', version: 1 }, render)
      await cache.getOrRender({ kind: 'map', key: 'b', version: 1 }, render)
      await cache.getOrRender({ kind: 'map', key: 'a', version: 1 }, render)
    })

    it('should bound the cache by it', () => {
      expect(render).toHaveBeenCalledTimes(3)
    })
  })

  describe('and IMAGE_CACHE_MAX_BYTES is not a positive integer', () => {
    beforeEach(async () => {
      getString.mockResolvedValueOnce('64MB')
      cache = await create()
    })

    it('should warn and use the default', () => {
      expect(warn).toHaveBeenCalledWith(
        'Invalid IMAGE_CACHE_MAX_BYTES, using the default',
        { value: '64MB', defaultValue: 64 * 1024 * 1024 }
      )
    })
  })
})
