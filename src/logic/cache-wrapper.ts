export type DependencyResult = string | number
export type DependencyFunction = () => DependencyResult

export function cacheWrapper<Arg, Ret>(
  handler: (x: Arg) => Promise<Ret>,
  deps: DependencyFunction[] = []
) {
  const cache = new Map<string, { deps: DependencyResult[]; response: Ret }>()

  return async (ctx: { url: URL } & Arg) => {
    const key = ctx.url.toString()
    const data = cache.get(key)

    const currentDeps = deps.map((dep) => dep())

    if (data) {
      const isValid = !data.deps.some((dep, i) => dep !== currentDeps[i]) // check if any of the cached deps is different to the current deps
      if (isValid) {
        return data.response
      } else {
        cache.delete(key) // clean cache if invalidated
      }
    }

    const response = await handler(ctx)

    cache.set(key, {
      deps: currentDeps,
      response: response,
    })

    return response
  }
}
