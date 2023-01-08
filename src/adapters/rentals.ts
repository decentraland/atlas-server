import { RentalListing } from '@dcl/schemas'
import { NFT } from '../modules/api/types'
import { LegacyTile, Tile } from '../modules/map/types'

export type TileRentalListing = Pick<
  RentalListing,
  'expiration' | 'createdAt' | 'periods'
>

export type LegacyTileWithShortenedRentalListing = Omit<
  LegacyTile,
  'rentalListing'
> & { rentalListing: TileRentalListing }
export type TileWithShortenedRentalListing = Omit<Tile, 'rentalListing'> & {
  rentalListing: TileRentalListing
}

export function convertRentalListingToShortenedRentalListing(
  rentalListing: RentalListing
): TileRentalListing {
  return {
    expiration: rentalListing.expiration,
    createdAt: rentalListing.createdAt,
    periods: rentalListing.periods,
  }
}

// export function shortenRentalListing<
//   T extends { rentalListing?: RentalListing }
// >(
//   tiles: Record<string, T>
// ): Record<
//   string,
//   Omit<T, 'rentalListing'> & { rentalListing?: TileRentalListing }
// > {
//   return Object.keys(tiles).reduce((prev, current) => {
//     const newTile = {
//       ...tiles[current],
//       rentalListing: tiles[current].rentalListing
//         ? convertRentalListingToShortenedRentalListing(
//             tiles[current].rentalListing!
//           )
//         : undefined,
//     }

//     if (!newTile.rentalListing) {
//       delete newTile.rentalListing
//     }

//     return { ...prev, [current]: newTile }
//   }, {})
// }

// export function shortenNFTRentalListing(
//   nft: NFT
// ): Omit<NFT, 'rentalListing'> & { rentalListing?: TileRentalListing } {
//   const newNFT = {
//     ...nft,
//     rentalListing: nft.rentalListing
//       ? convertRentalListingToShortenedRentalListing(nft.rentalListing)
//       : undefined,
//   }

//   if (!newNFT.rentalListing) {
//     delete newNFT.rentalListing
//   }

//   return newNFT
// }
