import { IHttpServerComponent } from '@dcl/core-commons'
import { Context } from '../types'

const THREE_MINUTES = 180
const TWO_MINUTES = 120

function toHeaderRecord(headers: HeadersInit = {}): Record<string, string> {
  if (headers instanceof Headers || Array.isArray(headers)) {
    return Object.fromEntries(new Headers(headers).entries())
  }
  return { ...headers }
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name)
}

export function lastModifiedMiddleware(
  getLastModifiedTime: () => number,
  options: { maxAge?: number; staleWhileRevalidate?: number } = {
    maxAge: TWO_MINUTES,
    staleWhileRevalidate: THREE_MINUTES,
  }
): IHttpServerComponent.IRequestHandler<Context<string>> {
  const cacheControlHeader = `max-age=${options.maxAge}, s-maxage=${options.maxAge}, stale-while-revalidate=${options.staleWhileRevalidate}, public`

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
    const status = response.status ?? 200
    // errors and redirects must not be cached publicly with the map's date
    if (status < 200 || status >= 300) {
      return response
    }

    const headers = toHeaderRecord(response.headers)
    response.headers = {
      ...headers,
      ...(hasHeader(headers, 'last-modified')
        ? {}
        : { 'Last-Modified': lastModifiedHeader }),
      ...(hasHeader(headers, 'cache-control')
        ? {}
        : { 'Cache-Control': cacheControlHeader }),
    }

    return response
  }
}
