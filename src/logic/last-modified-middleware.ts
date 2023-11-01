import { IHttpServerComponent } from '@well-known-components/interfaces'
import { Context } from '../types'

const THREE_MINUTES = 180
const TWO_MINUTES = 120

export function lastModifiedMiddleware(
  getLastModifiedTime: () => number,
  options: { maxAge?: number; staleWhileRevalidate?: number } = {
    maxAge: TWO_MINUTES,
    staleWhileRevalidate: THREE_MINUTES,
  }
): IHttpServerComponent.IRequestHandler<Context<string>> {
  const cacheControlHeader = `max-age=${options.maxAge}, stale-while-revalidate=${options.staleWhileRevalidate}, public`

  return async (context, next): Promise<IHttpServerComponent.IResponse> => {
    const lastModifiedTime = getLastModifiedTime()
    const lastModifiedHeader = new Date(lastModifiedTime).toUTCString()
    const ifModifiedSinceHeader =
      context.request.headers.get('If-Modified-Since')

    if (ifModifiedSinceHeader) {
      const ifModifiedSinceTime = Date.parse(ifModifiedSinceHeader)
      if (
        !isNaN(ifModifiedSinceTime) &&
        lastModifiedTime <= ifModifiedSinceTime
      ) {
        return {
          status: 304,
          headers: {
            'Last-Modified': lastModifiedHeader,
            'Cache-Control': cacheControlHeader,
          },
        }
      }
    }

    const response = await next()
    response.headers = {
      ...response.headers,
      'Last-Modified': lastModifiedHeader,
      'Cache-Control': cacheControlHeader,
    }

    return response
  }
}
