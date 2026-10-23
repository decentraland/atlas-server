import { RenderMapArgs } from './map'
import { Layer } from './types'

const TOP = 1
const LEFT = 2
const TOP_LEFT = 4

export type MapStyle = {
  color: string
  scale?: number
}

/**
 * One layer resolved over the viewport, one cell per parcel in renderMap's
 * loop order: column by column from nw.x, each column from se.y upwards.
 */
export type MapSceneLayer = {
  /** 1-based index into the scene palette; 0 means the layer has no tile there */
  styles: Uint16Array
  /** TOP | LEFT | TOP_LEFT bits */
  flags: Uint8Array
}

/** A map render as plain, transferable data: renderMap's arguments without the canvas. */
export type MapScene = Omit<RenderMapArgs, 'ctx' | 'layers'> & {
  palette: MapStyle[]
  layers: MapSceneLayer[]
}

function getSceneSize(scene: Pick<MapScene, 'nw' | 'se'>) {
  const { nw, se } = scene
  return { columns: se.x - nw.x, rows: nw.y - se.y }
}

/**
 * Resolves the layers over the viewport so the render no longer needs the tiles.
 * @param args - renderMap's arguments without the canvas.
 * @returns the scene to draw.
 */
export function describeMap(args: Omit<RenderMapArgs, 'ctx'>): MapScene {
  const { layers, ...viewport } = args
  const { nw, se } = viewport
  const { columns, rows } = getSceneSize(viewport)
  const cells = Math.max(columns, 0) * Math.max(rows, 0)
  const palette: MapStyle[] = []
  const styleIndexes = new Map<string, number>()

  function getStyleIndex(color: string, scale: number | undefined): number {
    const key = `${color}|${scale}`
    let index = styleIndexes.get(key)
    if (index === undefined) {
      palette.push(scale === undefined ? { color } : { color, scale })
      index = palette.length
      styleIndexes.set(key, index)
    }
    return index
  }

  const sceneLayers = layers.map((layer) => {
    const styles = new Uint16Array(cells)
    const flags = new Uint8Array(cells)
    let cell = 0
    for (let x = nw.x; x < se.x; x++) {
      for (let y = se.y; y < nw.y; y++, cell++) {
        const tile = layer(x, y)
        if (!tile) {
          continue
        }
        styles[cell] = getStyleIndex(tile.color, tile.scale)
        flags[cell] =
          (tile.top ? TOP : 0) |
          (tile.left ? LEFT : 0) |
          (tile.topLeft ? TOP_LEFT : 0)
      }
    }
    return { styles, flags }
  })

  return { ...viewport, palette, layers: sceneLayers }
}

/**
 * Turns the scene back into the layers renderMap draws.
 * @param scene - a scene built by describeMap.
 * @returns renderMap's arguments without the canvas.
 */
export function getSceneLayers(scene: MapScene): Layer[] {
  const { nw, se, palette } = scene
  const { rows } = getSceneSize(scene)
  return scene.layers.map(({ styles, flags }) => (x, y) => {
    const cell = (x - nw.x) * rows + (y - se.y)
    const style = styles[cell]
    if (!style) {
      return null
    }
    const { color, scale } = palette[style - 1]
    const flag = flags[cell]
    return {
      color,
      top: (flag & TOP) !== 0,
      left: (flag & LEFT) !== 0,
      topLeft: (flag & TOP_LEFT) !== 0,
      scale,
    }
  })
}

/**
 * @param scene - a scene built by describeMap.
 * @returns the buffers to transfer to the worker instead of copying them.
 */
export function getSceneTransferList(scene: MapScene): ArrayBufferLike[] {
  return scene.layers.flatMap(({ styles, flags }) => [
    styles.buffer,
    flags.buffer,
  ])
}
