import { createImageComponent } from '../../src/modules/image/component'
import { IImageComponent } from '../../src/modules/image/types'
import { IMapComponent, Tile, TileType } from '../../src/modules/map/types'
import { readStream } from '../helpers/png'

describe('when rendering a map image', () => {
  let image: IImageComponent
  let tiles: Record<string, Tile>
  let showOnSale: boolean
  let showListedForRent: boolean
  let render: () => Promise<Buffer>

  beforeEach(() => {
    tiles = {
      '0,0': {
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
      },
    }
    image = createImageComponent({
      map: {
        getTiles: jest.fn().mockResolvedValue(tiles),
      } as unknown as IMapComponent,
    })
    render = async () =>
      readStream(
        await image.getStream(
          200,
          200,
          20,
          { x: 150, y: 150 },
          [],
          showOnSale,
          showListedForRent
        )
      )
  })

  describe('and the viewport goes past the edge of the map', () => {
    describe('and the parcels on sale are highlighted', () => {
      beforeEach(() => {
        showOnSale = true
        showListedForRent = false
      })

      it('should render the image', async () => {
        await expect(render()).resolves.toBeInstanceOf(Buffer)
      })
    })

    describe('and the parcels listed for rent are highlighted', () => {
      beforeEach(() => {
        showOnSale = false
        showListedForRent = true
      })

      it('should render the image', async () => {
        await expect(render()).resolves.toBeInstanceOf(Buffer)
      })
    })
  })
})
