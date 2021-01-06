import { IHttpServerComponent as http } from '@well-known-components/interfaces'

// caches a request using a set of dependency functions
export function cacheWrapper<T>(
  handler: http.IRequestHandler<T>,
  deps: CallableFunction[] = []
): http.IRequestHandler<T> {
  const cache: Record<string, { deps: any[]; response: ResponseInit }> = {}

  return async (context) => {
    const key = context.request.url
    const data = cache[key]

    const currentDeps = deps.map((dep) => dep())

    if (data) {
      const isValid = !data.deps.some((dep, i) => dep !== currentDeps[i]) // check if any of the cached deps is different to the current deps
      if (isValid) {
        return data.response!
      } else {
        delete cache[key] // clean cache if invalidated
      }
    }

    const response = await handler(context)

    cache[key] = {
      deps: currentDeps,
      response,
    }

    return response
  }
}