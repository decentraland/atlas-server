import {
  EstateFragment,
  ParcelFragment,
  OrderFragment,
  Proximity,
} from './types'
import proximities from './data/proximity.json'

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
