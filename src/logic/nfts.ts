/** Checks whether a NFT ID belong to a parcel.
 * @param nftId A NFT ID
 */
export function isNftIdFromParcel(nftId: string): boolean {
  return nftId.startsWith('parcel')
}

/** Checks whether a NFT ID belong to an estate.
 * @param nftId A NFT ID
 */
export function isNftIdFromEstate(nftId: string): boolean {
  return nftId.startsWith('estate')
}

/** Gets the token id from a NFT ID by retrieving the latest section of it.
 * @param nftId A NFT ID
 */
export function getTokenIdFromNftId(nftId: string): string | undefined {
  return nftId.split('-')[2]
}

/** Performs a left merge of an array, removing duplicates by id, favouring the items on the right array.
 * @param leftItems An array of items
 * @param rightItems An array of items
 */
export function leftMerge<T extends { id: string }>(
  leftItems: T[],
  rightItems: T[]
): T[] {
  const result = new Map<string, T>()
  for (const item of leftItems) {
    result.set(item.id, item)
  }
  for (const item of rightItems) {
    result.set(item.id, item)
  }

  return Array.from(result.values())
}
