import {
  createEstatesRendererComponent,
  MiniMapRendererComponent,
} from '../../src/adapters/mini-map-renderer'
import { Tile, TileType } from '../../src/modules/map/types'
import { decodePng } from '../helpers/png'
import { startRenderPool, StartedRenderPool } from '../helpers/render-pool'

function buildTile(x: number, y: number, estateId?: string): Tile {
  return {
    id: `${x},${y}`,
    x,
    y,
    type: TileType.OWNED,
    top: false,
    left: false,
    topLeft: false,
    updatedAt: 1,
    estateId,
  }
}

describe('when rendering the estates minimap', () => {
  let renderer: MiniMapRendererComponent
  let tiles: Tile[]
  let estateIndexAt: (x: number, y: number) => number
  let renderPool: StartedRenderPool

  beforeEach(async () => {
    renderPool = await startRenderPool()
    tiles = [
      buildTile(0, 0, '10'),
      buildTile(1, 0, '20'),
      buildTile(2, 0, '10'),
      buildTile(3, 0, '20'),
      buildTile(4, 0),
    ]
    renderer = await createEstatesRendererComponent()
    const record = Object.fromEntries(tiles.map((tile) => [tile.id, tile]))
    const pixelAt = await decodePng(
      await renderPool.pool.render('estatemap', () =>
        renderer.getRenderJob(record)
      )
    )
    estateIndexAt = (x, y) => {
      const [r, g, b] = pixelAt(x + 256, 512 - (y + 256))
      return (r << 16) | (g << 8) | b
    }
  })

  afterEach(async () => {
    await renderPool.stop()
  })

  it('should encode every parcel of an estate with the same index', () => {
    expect([estateIndexAt(0, 0), estateIndexAt(2, 0)]).toEqual([1, 1])
  })

  it('should encode each estate with its own index', () => {
    expect([estateIndexAt(1, 0), estateIndexAt(3, 0)]).toEqual([2, 2])
  })

  it('should encode a parcel without an estate as 0', () => {
    expect(estateIndexAt(4, 0)).toBe(0)
  })
})

describe('when rendering the estates minimap of the same tiles stored in different orders', () => {
  let renderPool: StartedRenderPool
  let pngs: Buffer[]
  let estateIndexAt: (x: number, y: number) => number

  beforeEach(async () => {
    renderPool = await startRenderPool()
    const tiles = [
      buildTile(0, 0, '20'),
      buildTile(1, 0, '9'),
      buildTile(2, 0, '10'),
      buildTile(3, 0, 'legacy'),
      buildTile(4, 0),
    ]
    pngs = []
    for (const ordered of [tiles, [...tiles].reverse()]) {
      const renderer = await createEstatesRendererComponent()
      const record = Object.fromEntries(ordered.map((tile) => [tile.id, tile]))
      pngs.push(
        await renderPool.pool.render('estatemap', () =>
          renderer.getRenderJob(record)
        )
      )
    }
    const pixelAt = await decodePng(pngs[0])
    estateIndexAt = (x, y) => {
      const [r, g, b] = pixelAt(x + 256, 512 - (y + 256))
      return (r << 16) | (g << 8) | b
    }
  })

  afterEach(async () => {
    await renderPool.stop()
  })

  it('should render byte identical images', () => {
    expect(pngs[0].equals(pngs[1])).toBe(true)
  })

  it('should number the estates by token id, then any other id', () => {
    expect([0, 1, 2, 3].map((x) => estateIndexAt(x, 0))).toEqual([3, 1, 2, 4])
  })
})
