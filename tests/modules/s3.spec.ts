import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import {
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'
import { gunzipSync, gzipSync } from 'zlib'
import { createS3Component, IS3Component } from '../../src/modules/s3/component'
import { Tile, TileType } from '../../src/modules/map/types'

describe('when using the S3 component', () => {
  let s3: IS3Component
  let send: jest.SpyInstance
  let tiles: Record<string, Tile>

  beforeEach(async () => {
    tiles = {
      '1,1': {
        id: '1,1',
        x: 1,
        y: 1,
        type: TileType.OWNED,
        top: false,
        left: false,
        topLeft: false,
        updatedAt: 1000,
      },
    }
    const values: Record<string, string> = {
      AWS_S3_BUCKET: 'a-bucket',
      CDN_URL: 'https://cdn.example.com',
    }
    const config = {
      getString: jest.fn((name: string) => Promise.resolve(values[name])),
    } as unknown as IConfigComponent
    const logs: ILoggerComponent = {
      getLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        log: jest.fn(),
      }),
    }
    send = jest.spyOn(S3Client.prototype, 'send')
    s3 = await createS3Component({ config, logs })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('and uploading the tiles', () => {
    let input: PutObjectCommand['input']

    beforeEach(async () => {
      send.mockResolvedValueOnce({})
      await s3.uploadTilesJson('v2', tiles)
      input = (send.mock.calls[0][0] as PutObjectCommand).input
    })

    it('should mark the object as gzip encoded JSON', () => {
      expect(input).toEqual(
        expect.objectContaining({
          Key: 'tiles/v2/latest.json',
          ContentType: 'application/json',
          ContentEncoding: 'gzip',
        })
      )
    })

    it('should upload the gzip compressed tiles response', () => {
      expect(
        JSON.parse(gunzipSync(input.Body as Buffer).toString('utf8'))
      ).toEqual({ ok: true, data: tiles })
    })

    it('should not set custom metadata on the object', () => {
      expect(input.Metadata).toBeUndefined()
    })
  })

  describe('and reading the tiles back', () => {
    let body: Buffer
    let contentEncoding: string | undefined
    let result: Record<string, Tile> | null

    beforeEach(() => {
      send.mockImplementationOnce(async () => ({
        ContentEncoding: contentEncoding,
        Body: {
          transformToByteArray: async () => new Uint8Array(body),
        },
      }))
    })

    describe('and the object is gzip encoded', () => {
      beforeEach(async () => {
        contentEncoding = 'gzip'
        body = gzipSync(JSON.stringify({ ok: true, data: tiles }))
        result = await s3.getTilesJson('v2')
      })

      it('should respond with the decompressed tiles', () => {
        expect(result).toEqual(tiles)
      })
    })

    describe('and the object was uploaded without compression', () => {
      beforeEach(async () => {
        contentEncoding = undefined
        body = Buffer.from(JSON.stringify({ ok: true, data: tiles }))
        result = await s3.getTilesJson('v2')
      })

      it('should respond with the tiles', () => {
        expect(result).toEqual(tiles)
      })
    })

    describe('and the object is gzip compressed without the encoding header', () => {
      beforeEach(async () => {
        contentEncoding = undefined
        body = gzipSync(JSON.stringify({ ok: true, data: tiles }))
        result = await s3.getTilesJson('v2')
      })

      it('should respond with the decompressed tiles', () => {
        expect(result).toEqual(tiles)
      })
    })
  })
})
