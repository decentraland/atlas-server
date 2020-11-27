export type Coord = {
  x: number
  y: number
}

export type Layer = (x: number, y: number) => Tile | null

export type Tile = {
  color: string
  top?: boolean
  left?: boolean
  topLeft?: boolean
  scale?: number
}
