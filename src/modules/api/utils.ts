import { RentalListing } from '@dcl/schemas'
import {
  convertRentalListingToTileRentalListing,
  TileRentalListing,
} from '../../adapters/rentals'
import { isRentalListingOpen } from '../../logic/rental'
import { Tile } from '../map/types'
import { ParcelFragment, OrderFragment, Proximity } from './types'
import proximities from './data/proximity.json'

export function isExpired(order: OrderFragment) {
  const expirationDate =
    order.expiresAt.length === 10
      ? parseInt(order.expiresAt, 10)
      : Math.round(parseInt(order.expiresAt, 10) / 1000)
  return expirationDate <= Math.round(Date.now() / 1000)
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

export function getParcelFragmentRentalListing(
  parcel: ParcelFragment,
  newRentalListings: Record<string, RentalListing>,
  oldTilesByNftId: Record<string, Tile>
): TileRentalListing | undefined {
  const nftId = parcel.searchParcelEstateId ?? parcel.id

  if (newRentalListings[nftId]) {
    return newRentalListings[nftId] &&
      isRentalListingOpen(newRentalListings[nftId])
      ? convertRentalListingToTileRentalListing(newRentalListings[nftId])
      : undefined
  } else if (
    oldTilesByNftId[parcel.id] &&
    oldTilesByNftId[parcel.id].rentalListing
  ) {
    return oldTilesByNftId[parcel.id].rentalListing
  }

  return undefined
}
