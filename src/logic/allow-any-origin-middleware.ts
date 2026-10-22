import { IHttpServerComponent } from '@dcl/core-commons'

/**
 * Sets `Access-Control-Allow-Origin: *` on every response. The @dcl/http-server
 * CORS middleware only adds it when the request carries an Origin, so a shared
 * cache could store a response without it and serve it to browsers.
 * @returns a middleware that adds the header unless the response already has one
 */
export function allowAnyOriginMiddleware<
  Context extends object
>(): IHttpServerComponent.IRequestHandler<Context> {
  return async (_context, next): Promise<IHttpServerComponent.IResponse> => {
    const response = await next()
    const headers = new Headers(response.headers)
    if (!headers.has('Access-Control-Allow-Origin')) {
      headers.set('Access-Control-Allow-Origin', '*')
    }
    return { ...response, headers }
  }
}
