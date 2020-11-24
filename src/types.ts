export enum TileType {
  OWNED = 'owned',
  UNOWNED = 'unowned',
  PLAZA = 'plaza',
  ROAD = 'road',
  DISTRICT = 'district',
}

export type Tile = {
  id: string
  x: number
  y: number
  type: TileType
  name: string
  top: boolean
  left: boolean
  topLeft: boolean
  updatedAt: number
  owner: string | null
  estateId: string | null
  tokenId: string | null
  price: number | null
}
