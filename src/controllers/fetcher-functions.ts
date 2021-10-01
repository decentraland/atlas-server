import { AppComponents } from '../types'

export type CatalystSnapshot = Array<[string, string[]]>

export async function getCatalystBaseUrl(
  components: Pick<AppComponents, 'config'>
): Promise<string> {
  const catalystUrl =
    (await components.config.getString('CATALYST_HOST')) ||
    'peer-lb.decentraland.org'
  return `https://${catalystUrl}`
}

export async function fetchSnapshotHash(
  components: Pick<AppComponents, 'config' | 'fetcher'>,
  entityType: string = 'scenes'
): Promise<{ hash: string; lastIncludedDeploymentTimestamp: number }> {
  const { fetcher } = components
  const url = new URL(
    `/content/snapshot/${entityType}`,
    await getCatalystBaseUrl(components)
  ).toString()
  const res = await fetcher.fetch(url)
  if (res.ok) return await res.json()
  throw new Error(
    'Error fetching ' +
      url +
      ' status code ' +
      res.status +
      ' response ' +
      (await res.text())
  )
}
