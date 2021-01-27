
import { Tile } from '../map/types'

export type NFT = {
  name: string
  description: string
  image: string
  external_url: string
  background_color: string
  attributes: Attribute[]
}

export type Attribute = {
  trait_type: string
  value: number
  display_type: 'number'
}

export type Proximity = {
  district?: number
  road?: number
  plaza?: number
}

export interface INFTComponent {
  getParcelFromTile: (tile: Tile) => NFT
  getEstateFromTile: (tiles: Tile[]) => NFT
  getNFTFromTile: (tiles: Tile[]) => NFT
}