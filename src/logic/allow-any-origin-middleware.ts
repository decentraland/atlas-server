import { IHttpServerComponent } from '@dcl/core-commons'
import { fromNativeResponse } from '@dcl/http-server'
import { ILoggerComponent } from '@well-known-components/interfaces'

type HttpStatusError = {
  status?: number
  statusCode?: number
  body?: IHttpServerComponent.IResponse['body']
  message?: string
  headers?: HeadersInit
}

// same check @dcl/http-server uses to turn a thrown error into a response
function isHttpStatusError(error: unknown): error is HttpStatusError {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  return (
    ('status' in error && typeof error.status === 'number') ||
    ('statusCode' in error && typeof error.statusCode === 'number')
  )
}

function errorToResponse(
  error: unknown,
  logger: ILoggerComponent.ILogger
): IHttpServerComponent.IResponse {
  if (isHttpStatusError(error)) {
    const headers = new Headers(error.headers)
    if (!headers.has('Cache-Control')) {
      headers.set('Cache-Control', 'no-store')
    }
    return {
      status: error.status || error.statusCode,
      body: error.body || error.message,
      headers,
    }
  }
  logger.error(error instanceof Error ? error : String(error))
  return { status: 500, headers: { 'Cache-Control': 'no-store' } }
}

/**
 * Sets `Access-Control-Allow-Origin: *` on every response, including the ones
 * built from errors thrown by handlers. The @dcl/http-server CORS middleware
 * only adds it when the request carries an Origin, so a shared cache could
 * store a response without it and serve it to browsers, and a thrown error
 * would reach the browser as an opaque CORS failure.
 * @param components - `logs`, to report unexpected errors as the server would
 * @returns a middleware that adds the header unless the response already has one
 */
export function allowAnyOriginMiddleware<Context extends object>(components: {
  logs: ILoggerComponent
}): IHttpServerComponent.IRequestHandler<Context> {
  const logger = components.logs.getLogger('http-server')

  return async (_context, next): Promise<IHttpServerComponent.IResponse> => {
    let result: IHttpServerComponent.IResponse
    try {
      result = await next()
    } catch (error) {
      result = errorToResponse(error, logger)
    }
    // a native Response keeps status/body in getters that a spread would drop
    const response =
      result instanceof Response ? fromNativeResponse(result) : result
    const headers = new Headers(response.headers)
    if (!headers.has('Access-Control-Allow-Origin')) {
      headers.set('Access-Control-Allow-Origin', '*')
    }
    return { ...response, headers }
  }
}
