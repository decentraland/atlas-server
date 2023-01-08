export function isNftIdFromParcel(nftId: string): boolean {
  return nftId.startsWith('parcel')
}

export function isNftIdFromEstate(nftId: string): boolean {
  return nftId.startsWith('estate')
}

export function getTokenIdFromNftId(nftId: string): string | undefined {
  return nftId.split('-')[2]
}

export function leftMerge<T extends { id: string }>(
  leftItems: T[],
  rightItems: T[]
): T[] {
  const result: Record<string, T> = leftItems.reduce(
    (prev, current) => ({ ...prev, [current.id]: current }),
    {}
  )
  rightItems.forEach((item) => {
    if (!result[item.id]) {
      result[item.id] = item
    }
  })

  return Object.values(result)
}
