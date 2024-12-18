import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  S3ClientConfig,
} from '@aws-sdk/client-s3'
import {
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'
import { Tile, LegacyTile } from '../map/types'

export interface IS3Component {
  uploadTilesJson(
    version: string,
    tiles: Record<string, Partial<Tile | LegacyTile>>
  ): Promise<string>
  uploadTimestamp(timestamp: number): Promise<void>
  getTilesJson(version: string): Promise<Record<string, Tile> | null>
  getTimestamp(): Promise<number | null>
  getFileUrl(version: string): Promise<string>
}

export async function createS3Component(components: {
  config: IConfigComponent
  logs: ILoggerComponent
}): Promise<IS3Component> {
  const { config, logs } = components
  const componentLogger = logs.getLogger('S3 component')

  try {
    const region = (await config.getString('AWS_S3_REGION')) || 'us-east-1'
    const accessKeyId = await config.getString('AWS_ACCESS_KEY_ID')
    const secretAccessKey = await config.getString('AWS_SECRET_ACCESS_KEY')
    const bucketName = await config.getString('AWS_S3_BUCKET')
    const endpoint = await config.getString('AWS_S3_ENDPOINT')

    console.log('S3 Configuration')
    console.log(`REGION=${region}`)
    console.log(`BUCKET_NAME=${bucketName}`)
    console.log(`ENDPOINT=${endpoint}`)

    if (!bucketName) {
      componentLogger.warn(
        'Missing AWS bucket - S3 component will use stub implementation'
      )
      return createStubS3Component(componentLogger)
    }

    const s3Config: S3ClientConfig = {
      region,
    }

    if (endpoint) {
      console.log('Endpoint provided')
      s3Config.endpoint = endpoint
    } else {
      console.log('No endpoint provided')
    }

    // Only add credentials if they are provided
    if (accessKeyId && secretAccessKey) {
      console.log('Credentials provided')
      s3Config.credentials = {
        accessKeyId,
        secretAccessKey,
      }
    } else {
      console.log('No credentials provided')
    }

    const s3Client = new S3Client(s3Config)

    async function uploadTilesJson(
      version: 'v1' | 'v2',
      tiles: Record<string, Tile | LegacyTile>
    ): Promise<string> {
      const key = `tiles/${version}/latest.json`

      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: JSON.stringify({ ok: true, data: tiles }),
            ContentType: 'application/json',
            CacheControl: 'public, max-age=60',
          })
        )

        const fileUrl = endpoint
          ? `${endpoint}/${bucketName}/${key}`
          : `https://${bucketName}.s3.amazonaws.com/${key}`

        componentLogger.info(`Uploaded tiles to ${fileUrl}`)
        return fileUrl
      } catch (error) {
        componentLogger.error(`Failed to upload tiles to S3: ${error}`)
        throw error
      }
    }

    async function uploadTimestamp(timestamp: number): Promise<void> {
      const key = 'tiles/timestamp.json'

      try {
        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: JSON.stringify({ timestamp }),
            ContentType: 'application/json',
            CacheControl: 'public, max-age=60',
          })
        )
        componentLogger.info(`Uploaded timestamp to S3`)
      } catch (error) {
        componentLogger.error(`Failed to upload timestamp to S3: ${error}`)
        throw error
      }
    }

    async function getTilesJson(
      version: string
    ): Promise<Record<string, Tile> | null> {
      const key = `tiles/${version}/latest.json`

      try {
        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: key,
          })
        )

        const body = await response.Body?.transformToString()
        if (!body) return null

        const data = JSON.parse(body)
        return data.ok ? data.data : null
      } catch (error) {
        componentLogger.warn(`Failed to get tiles from S3: ${error}`)
        return null
      }
    }

    async function getTimestamp(): Promise<number | null> {
      const key = 'tiles/timestamp.json'

      try {
        const response = await s3Client.send(
          new GetObjectCommand({
            Bucket: bucketName,
            Key: key,
          })
        )

        const body = await response.Body?.transformToString()
        if (!body) return null

        const data = JSON.parse(body)
        return data.timestamp
      } catch (error) {
        componentLogger.warn(`Failed to get timestamp from S3: ${error}`)
        return null
      }
    }

    async function getFileUrl(version: string): Promise<string> {
      const key = `tiles/${version}/latest.json`
      return endpoint
        ? `${endpoint}/${bucketName}/${key}`
        : `https://${bucketName}.s3.amazonaws.com/${key}`
    }

    return {
      uploadTilesJson,
      uploadTimestamp,
      getTilesJson,
      getTimestamp,
      getFileUrl,
    }
  } catch (error) {
    componentLogger.warn(
      'Failed to initialize S3 component - will use stub implementation'
    )
    return createStubS3Component(componentLogger)
  }
}

function createStubS3Component(
  logger: ReturnType<ILoggerComponent['getLogger']>
): IS3Component {
  return {
    uploadTilesJson: async () => {
      logger.debug('Stub S3 component - upload operation ignored')
      return ''
    },
    uploadTimestamp: async () => {
      logger.debug('Stub S3 component - timestamp upload ignored')
    },
    getTilesJson: async () => {
      logger.debug('Stub S3 component - get tiles operation ignored')
      return null
    },
    getTimestamp: async () => {
      logger.debug('Stub S3 component - get timestamp operation ignored')
      return null
    },
    getFileUrl: async () => {
      logger.debug('Stub S3 component - get file URL operation ignored')
      return ''
    },
  }
}
