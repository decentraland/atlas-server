import {
  Middleware,
  IHttpServerComponent as http,
  IAdapterHandler,
} from '@well-known-components/interfaces'
import { Stream } from 'stream'
import { AppComponents } from '../types'

export function createDappsWrapper<T>(components: Pick<AppComponents, 'logs'>) {
  const { logs } = components
  const logger = logs.getLogger('dapps-wrapper')

  const middleware = Middleware.compose<http.DefaultContext<T>, http.IResponse>(
    async (ctx, next) => {
      try {
        const result = await next()

        if ('body' in result) {
          // in case of streaming binaries, we redirect the result as is
          if (
            result.body instanceof Uint8Array ||
            result.body instanceof Buffer ||
            result.body instanceof Stream ||
            typeof result.body == 'string'
          ) {
            return result
          } else {
            // otherwise we wrap the response in our wrapper
            return {
              ...result,
              body: {
                ok: true,
                data: result.body,
              },
            }
          }
        }

        return result
      } catch (error) {
        logger.error(error, {
          method: ctx.request.method,
          url: ctx.request.url,
        })
        // errors are not reported to the clients since it would be a security issue
        return {
          status: 500,
          body: { ok: false },
        }
      }
    }
  )

  // TODO: abstract this helper
  return (handler: IAdapterHandler<http.DefaultContext<T>, http.IResponse>): IAdapterHandler<http.DefaultContext<T>, http.IResponse> => {
    return async (context: http.DefaultContext<T>) => {
      return middleware(context, handler)
    }
  }
}
