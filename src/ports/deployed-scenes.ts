import { IBaseComponent } from '@well-known-components/interfaces'
import { fetchSnapshotHash, getCatalystBaseUrl } from '../controllers/fetcher-functions'
import { AppComponents } from '../types'

export type DeployedScenesComponent = {
  getScenes(): Promise<any>
}

export async function createDeployedScenesComponenty(
  components: Pick<AppComponents, 'fetcher' | 'config'>
): Promise<DeployedScenesComponent & IBaseComponent> {
  return {
    async getScenes() {
      const snapshot = await fetchSnapshotHash(components, 'scenes')
      const catalystUrl = await getCatalystBaseUrl(components)
      const url = new URL(`/content/contents/${snapshot.hash}`, catalystUrl).toString()
      const content = await components.fetcher.fetch(url)
      return await content.json()
    },
  }
}
