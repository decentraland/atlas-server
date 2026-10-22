import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { createConfigComponent } from '@well-known-components/env-config-provider'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { createS3Component, IS3Component } from '../../src/modules/s3/component'
import { Tile, TileType } from '../../src/modules/map/types'

type StoredObject = {
  input: PutObjectCommand['input']
  bytes: Uint8Array
}

function toBytes(body: unknown): Uint8Array {
  if (typeof body === 'string') return Buffer.from(body)
  if (body instanceof Uint8Array) return body
  throw new Error('Unexpected body type in the fake S3 store')
}

describe('when using the S3 component', () => {
  let logs: ILoggerComponent
  let env: Record<string, string>
  let bucket: Map<string, StoredObject>
  let sendSpy: jest.SpyInstance
  let s3: IS3Component
  let tile: Tile

  beforeEach(() => {
    logs = {
      getLogger: () => ({
        log: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      }),
    }
    env = { AWS_S3_BUCKET: 'atlas-bucket', AWS_S3_REGION: 'us-east-1' }
    tile = {
      id: '1,2',
      x: 1,
      y: 2,
      type: TileType.OWNED,
      top: false,
      left: true,
      topLeft: false,
      updatedAt: 1000,
      owner: '0xowner',
    }
    bucket = new Map()
    jest.spyOn(console, 'log').mockImplementation(() => undefined)
    // an in-memory bucket: keeps whatever is put and hands it back on get
    sendSpy = jest
      .spyOn(S3Client.prototype, 'send')
      .mockImplementation(async (command: unknown) => {
        if (command instanceof PutObjectCommand) {
          bucket.set(command.input.Key as string, {
            input: command.input,
            bytes: toBytes(command.input.Body),
          })
          return {}
        }
        if (command instanceof GetObjectCommand) {
          const stored = bucket.get(command.input.Key as string)
          if (!stored) {
            throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })
          }
          return {
            ContentEncoding: stored.input.ContentEncoding,
            ContentType: stored.input.ContentType,
            Body: {
              transformToString: async () =>
                Buffer.from(stored.bytes).toString('utf8'),
              transformToByteArray: async () => stored.bytes,
            },
          }
        }
        throw new Error('Unexpected S3 command')
      })
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  describe('and no bucket is configured', () => {
    beforeEach(async () => {
      s3 = await createS3Component({
        config: createConfigComponent({}),
        logs,
      })
    })

    describe('and tiles are uploaded and read back', () => {
      let result: { url: string; tiles: Record<string, Tile> | null }

      beforeEach(async () => {
        result = {
          url: await s3.uploadTilesJson('v2', { [tile.id]: tile }),
          tiles: await s3.getTilesJson('v2'),
        }
      })

      it('should not reach S3 and behave as an empty bucket', () => {
        expect({ ...result, sends: sendSpy.mock.calls.length }).toEqual({
          url: '',
          tiles: null,
          sends: 0,
        })
      })
    })
  })

  describe('and a bucket is configured', () => {
    describe('and neither a CDN nor an endpoint are configured', () => {
      beforeEach(async () => {
        s3 = await createS3Component({
          config: createConfigComponent(env),
          logs,
        })
      })

      describe('and the v2 tiles are uploaded', () => {
        let url: string

        beforeEach(async () => {
          url = await s3.uploadTilesJson('v2', { [tile.id]: tile })
        })

        it('should store them under the versioned latest key of the bucket', () => {
          expect(sendSpy.mock.calls[0][0].input).toEqual(
            expect.objectContaining({
              Bucket: 'atlas-bucket',
              Key: 'tiles/v2/latest.json',
              ContentType: 'application/json',
            })
          )
        })

        it('should return the public S3 URL of the uploaded file', () => {
          expect(url).toBe(
            'https://atlas-bucket.s3.amazonaws.com/tiles/v2/latest.json'
          )
        })
      })

      describe('and the v1 file URL is requested', () => {
        let url: string

        beforeEach(async () => {
          url = await s3.getFileUrl('v1')
        })

        it('should return the public S3 URL of the v1 file', () => {
          expect(url).toBe(
            'https://atlas-bucket.s3.amazonaws.com/tiles/v1/latest.json'
          )
        })
      })

      describe('and tiles are uploaded and read back', () => {
        let tiles: Record<string, Tile> | null

        beforeEach(async () => {
          await s3.uploadTilesJson('v2', { [tile.id]: tile })
          tiles = await s3.getTilesJson('v2')
        })

        it('should read the same tiles that were uploaded', () => {
          expect(tiles).toEqual({ [tile.id]: tile })
        })
      })

      describe('and tiles of a version that was never uploaded are read', () => {
        let tiles: Record<string, Tile> | null

        beforeEach(async () => {
          await s3.uploadTilesJson('v2', { [tile.id]: tile })
          tiles = await s3.getTilesJson('v1')
        })

        it('should return null', () => {
          expect(tiles).toBeNull()
        })
      })

      describe('and a timestamp is uploaded', () => {
        beforeEach(async () => {
          await s3.uploadTimestamp(1234, 2)
        })

        it('should store it under the timestamp key of the bucket', () => {
          expect(sendSpy.mock.calls[0][0].input).toEqual(
            expect.objectContaining({
              Bucket: 'atlas-bucket',
              Key: 'tiles/timestamp.json',
            })
          )
        })
      })

      describe('and a timestamp is uploaded and read back', () => {
        let timestamp: Awaited<ReturnType<IS3Component['getTimestamp']>>

        beforeEach(async () => {
          await s3.uploadTimestamp(1234, 2)
          timestamp = await s3.getTimestamp()
        })

        it('should read the same timestamp and format version', () => {
          expect(timestamp).toEqual({ timestamp: 1234, version: 2 })
        })
      })

      describe('and the timestamp was never uploaded', () => {
        let timestamp: Awaited<ReturnType<IS3Component['getTimestamp']>>

        beforeEach(async () => {
          timestamp = await s3.getTimestamp()
        })

        it('should return null', () => {
          expect(timestamp).toBeNull()
        })
      })

      describe('and the upload fails', () => {
        let error: unknown

        beforeEach(async () => {
          sendSpy.mockRejectedValueOnce(new Error('Access Denied'))
          error = await s3
            .uploadTilesJson('v2', { [tile.id]: tile })
            .catch((uploadError: unknown) => uploadError)
        })

        it('should reject with the S3 error', () => {
          expect(error).toEqual(new Error('Access Denied'))
        })
      })
    })

    describe('and an endpoint is configured', () => {
      beforeEach(async () => {
        s3 = await createS3Component({
          config: createConfigComponent({
            ...env,
            AWS_S3_ENDPOINT: 'http://minio.test:9000',
          }),
          logs,
        })
      })

      describe('and the v2 file URL is requested', () => {
        let url: string

        beforeEach(async () => {
          url = await s3.getFileUrl('v2')
        })

        it('should return the path-style URL on the endpoint', () => {
          expect(url).toBe(
            'http://minio.test:9000/atlas-bucket/tiles/v2/latest.json'
          )
        })
      })
    })

    describe('and a CDN is configured', () => {
      beforeEach(async () => {
        s3 = await createS3Component({
          config: createConfigComponent({
            ...env,
            AWS_S3_ENDPOINT: 'http://minio.test:9000',
            CDN_URL: 'https://cdn.test',
          }),
          logs,
        })
      })

      describe('and the v2 tiles are uploaded', () => {
        let url: string

        beforeEach(async () => {
          url = await s3.uploadTilesJson('v2', { [tile.id]: tile })
        })

        it('should return the CDN URL of the uploaded file', () => {
          expect(url).toBe('https://cdn.test/tiles/v2/latest.json')
        })
      })
    })
  })
})
