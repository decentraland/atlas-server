import {
  EstateFragment,
  ParcelFragment,
  OrderFragment,
  Proximity,
} from './types'
import proximities from './data/proximity.json'
import fetch from 'node-fetch'
import { sleep } from '../map/utils'

// helper to do GraphQL queries with retry logic
export async function graphql<T>(
  url: string,
  query: string,
  retries = 5,
  retryDelay = 500
): Promise<T> {
  try {
    const res = await fetch(url, {
      method: 'post',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
      }),
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch TheGraph: ${await res.text()}`)
    }

    const result: { data: T } = await res.json()

    if (!result || !result.data || Object.keys(result.data).length === 0) {
      throw new Error(`Invalid response. Result: ${JSON.stringify(result)}`)
    }

    return result.data
  } catch (error) {
    // retry
    console.log(`Retrying graphql fetch. Error: ${error.message}.`)

    if (retries > 0) {
      // retry
      await sleep(retryDelay)
      return graphql<T>(url, query, retries - 1, retryDelay * 2)
    } else {
      throw error // bubble up
    }
  }
}

export function isExpired(order: OrderFragment) {
  return parseInt(order.expiresAt) <= Date.now()
}

export const getProximity = (
  coords: { x: number | string; y: number | string }[]
) => {
  let proximity: Proximity | undefined
  for (const { x, y } of coords) {
    const id = x + ',' + y
    const coordProximity = (proximities as Record<string, Proximity>)[id]
    if (coordProximity) {
      if (proximity === undefined) {
        proximity = {}
      }
      if (
        coordProximity.district !== undefined &&
        (proximity.district === undefined ||
          coordProximity.district < proximity.district)
      ) {
        proximity.district = coordProximity.district
      }
      if (
        coordProximity.plaza !== undefined &&
        (proximity.plaza === undefined ||
          coordProximity.plaza < proximity.plaza)
      ) {
        proximity.plaza = coordProximity.plaza
      }
      if (
        coordProximity.road !== undefined &&
        (proximity.road === undefined || coordProximity.road < proximity.road)
      ) {
        proximity.road = coordProximity.road
      }
    }
  }
  return proximity
}

export function capitalize(text: string) {
  return text[0].toUpperCase() + text.slice(1)
}

export function buildFromEstates<T extends { id: string }>(
  estates: EstateFragment[],
  list: T[],
  build: (fragment: ParcelFragment) => T | null
) {
  // keep track of entries already added to the list
  const alreadyAdded = new Set<string>(list.map((entry) => entry.id))
  // fill list with new entries from EstateFragments
  return estates.reduce<T[]>(
    (entries, nft) =>
      // grab parcels from each estate
      nft.estate.parcels
        // build each entry from each ParcelFragment
        .map((parcel) => build(parcel.nft))
        // add entries to the list, only if not null and not added already
        .reduce((entries, entry) => {
          if (entry && !alreadyAdded.has(entry.id)) {
            entries.push(entry)
            alreadyAdded.add(entry.id)
          }
          return entries
        }, entries),
    []
  )
}
