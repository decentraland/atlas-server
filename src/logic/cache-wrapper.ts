export type DependencyResult = string | number
export type DependencyFunction = () => DependencyResult

export type CacheWrapperOptions = {
  /** Derives the cache key from the request URL. Defaults to the full URL. */
  getKey?: (url: URL) => string
  /** Maximum number of cached responses. */
  maxEntries?: number
  /** Maximum combined length of the cached string bodies. */
  maxBodyLength?: number
}

type CacheableResponse = { status: number; body?: unknown }

const DEFAULT_MAX_ENTRIES = 32
const DEFAULT_MAX_BODY_LENGTH = 64 * 1024 * 1024

/**
 * Caches the successful responses of a handler while the given dependencies keep
 * returning the same values. Entries are dropped as soon as any dependency changes,
 * the least recently used ones are evicted past the entry or body length limits, and
 * concurrent requests with the same key share a single handler call.
 */
export function cacheWrapper<Arg, Ret extends CacheableResponse>(
  handler: (x: Arg) => Promise<Ret>,
  deps: DependencyFunction[] = [],
  options: CacheWrapperOptions = {}
) {
  const {
    getKey = (url: URL) => url.toString(),
    maxEntries = DEFAULT_MAX_ENTRIES,
    maxBodyLength = DEFAULT_MAX_BODY_LENGTH,
  } = options
  const responses = new Map<string, { response: Ret; length: number }>()
  const inFlight = new Map<string, Promise<Ret>>()
  let cachedDeps: DependencyResult[] | undefined
  let generation = 0
  let cachedBodyLength = 0

  function syncDeps() {
    const currentDeps = deps.map((dep) => dep())
    const unchanged =
      cachedDeps !== undefined &&
      cachedDeps.length === currentDeps.length &&
      cachedDeps.every((dep, i) => dep === currentDeps[i])
    if (unchanged) {
      return
    }
    cachedDeps = currentDeps
    generation++
    responses.clear()
    inFlight.clear()
    cachedBodyLength = 0
  }

  function store(key: string, response: Ret) {
    const length = typeof response.body === 'string' ? response.body.length : 0
    if (response.status !== 200 || length > maxBodyLength) {
      return
    }
    responses.set(key, { response, length })
    cachedBodyLength += length
    // Map iteration follows insertion order, so the first entries are the least recently used
    for (const [oldestKey, entry] of responses) {
      if (responses.size <= maxEntries && cachedBodyLength <= maxBodyLength) {
        break
      }
      responses.delete(oldestKey)
      cachedBodyLength -= entry.length
    }
  }

  return async (ctx: { url: URL } & Arg): Promise<Ret> => {
    syncDeps()
    const key = getKey(ctx.url)

    const cached = responses.get(key)
    if (cached) {
      responses.delete(key)
      responses.set(key, cached)
      return cached.response
    }

    const pending = inFlight.get(key)
    if (pending) {
      return pending
    }

    const requestGeneration = generation
    const request: Promise<Ret> = handler(ctx)
      .then((response) => {
        if (requestGeneration === generation) {
          store(key, response)
        }
        return response
      })
      .finally(() => {
        if (inFlight.get(key) === request) {
          inFlight.delete(key)
        }
      })
    inFlight.set(key, request)
    return request
  }
}
