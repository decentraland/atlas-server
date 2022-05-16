import { Lifecycle } from '@well-known-components/interfaces'
import { setupLogs } from './controllers/logs'
import { setupRouter } from './controllers/routes'
import { AppComponents, GlobalContext, TestComponents } from './types'

// this function wires the business logic (adapters & controllers) with the components (ports)
export async function main(
  program: Lifecycle.EntryPointParameters<AppComponents | TestComponents>
) {
  const { components, startComponents } = program
  const globalContext: GlobalContext = {
    components,
  }

  // wire the HTTP router (make it automatic? TBD)
  const router = await setupRouter(components)
  components.server.use(router.middleware())
  components.server.setContext(globalContext)

  setupLogs(components)

  await startComponents()
}
