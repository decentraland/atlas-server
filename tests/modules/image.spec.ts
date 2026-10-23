import { createImageComponent } from '../../src/modules/image/component'
import { IImageComponent } from '../../src/modules/image/types'
import { Tile, TileType } from '../../src/modules/map/types'
import { startRenderPool, StartedRenderPool } from '../helpers/render-pool'

function buildListedTile(overrides: Partial<Tile> = {}): Tile {
  return {
    id: '0,0',
    x: 0,
    y: 0,
    type: TileType.OWNED,
    top: false,
    left: false,
    topLeft: false,
    updatedAt: 1,
    price: 10,
    expiresAt: Math.round(Date.now() / 1000) + 3600,
    ...overrides,
  }
}

describe('when rendering a map image', () => {
  let image: IImageComponent
  let renderPool: StartedRenderPool
  let render: (
    tiles: Record<string, Tile>,
    center: { x: number; y: number },
    showOnSale: boolean,
    showListedForRent: boolean
  ) => Promise<Buffer>

  beforeEach(async () => {
    renderPool = await startRenderPool()
    image = createImageComponent()
    render = (tiles, center, showOnSale, showListedForRent) =>
      renderPool.pool.render('map', () =>
        image.getRenderJob(
          tiles,
          200,
          200,
          20,
          center,
          [],
          showOnSale,
          showListedForRent
        )
      )
  })

  afterEach(async () => {
    await renderPool.stop()
  })

  describe('and the viewport goes past the edge of the map', () => {
    let tiles: Record<string, Tile>

    beforeEach(() => {
      tiles = { '0,0': buildListedTile() }
    })

    describe('and the parcels on sale are highlighted', () => {
      it('should render the image', async () => {
        await expect(
          render(tiles, { x: 150, y: 150 }, true, false)
        ).resolves.toBeInstanceOf(Buffer)
      })
    })

    describe('and the parcels listed for rent are highlighted', () => {
      it('should render the image', async () => {
        await expect(
          render(tiles, { x: 150, y: 150 }, false, true)
        ).resolves.toBeInstanceOf(Buffer)
      })
    })
  })

  describe.each([
    [
      'order',
      true,
      (expired: boolean) =>
        buildListedTile({
          expiresAt: Math.round(Date.now() / 1000) + (expired ? -60 : 3600),
        }),
      () => buildListedTile({ price: undefined, expiresAt: undefined }),
    ],
    [
      'rental listing',
      false,
      (expired: boolean) =>
        buildListedTile({
          price: undefined,
          expiresAt: undefined,
          rentalListing: {
            expiration: Date.now() + (expired ? -60_000 : 3_600_000),
            periods: [],
            updatedAt: 1,
          },
        }),
      () => buildListedTile({ price: undefined, expiresAt: undefined }),
    ],
  ])(
    'and a highlighted %s has expired but the map has not dropped it yet',
    (_name, onSale, buildTile, buildSweptTile) => {
      let pngs: { current: Buffer; expired: Buffer; swept: Buffer }

      beforeEach(async () => {
        const draw = (tile: Tile) =>
          render({ '0,0': tile }, { x: 0, y: 0 }, onSale, !onSale)
        pngs = {
          current: await draw(buildTile(false)),
          expired: await draw(buildTile(true)),
          swept: await draw(buildSweptTile()),
        }
      })

      it('should still draw it, as the image only depends on the tiles', () => {
        expect(pngs.expired.equals(pngs.current)).toBe(true)
      })

      it('should stop drawing it once the map drops it', () => {
        expect(pngs.swept.equals(pngs.current)).toBe(false)
      })
    }
  )
})
