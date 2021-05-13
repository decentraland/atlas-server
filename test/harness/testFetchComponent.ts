import { IFetchComponent } from '@well-known-components/http-server'
import nodeFetch, { Response, Request } from 'node-fetch'

const stateSymbol = Symbol('internalState')

export type FetchInterceptor = (
  req: Request
) => Promise<Response | null | undefined | void>

export type InternalFetchState = {
  interceptors: Array<FetchInterceptor>
}

export function getInternalState(component: any): InternalFetchState {
  if (!(stateSymbol in component)) {
    throw new Error(
      'the provided IFetchComponent has no test-state. Make sure it was generated using the createTestFetchComponent function'
    )
  }
  return component[stateSymbol]
}

export function addInterceptor(
  component: IFetchComponent,
  interceptor: FetchInterceptor
) {
  getInternalState(component).interceptors.push(interceptor)
}

export function clearInterceptors(component: IFetchComponent) {
  getInternalState(component).interceptors.length = 0
}

export async function createTestFetchComponent(
  serverHostnameAndProtocol: string
): Promise<IFetchComponent> {
  const state: InternalFetchState = {
    interceptors: [],
  }

  const ret = {
    async fetch(url, initRequest?) {
      if (typeof url == 'string' && url.startsWith('/')) {
        return nodeFetch(serverHostnameAndProtocol + url, { ...initRequest })
      } else {
        let req: Request = new Request(url, initRequest)

        for (let interceptor of state.interceptors) {
          const r = await interceptor(req)
          if (r) return r
        }

        return nodeFetch(req)
      }
    },
    [stateSymbol]: state,
  }

  return ret
}
