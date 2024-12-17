import { S3Client, PutObjectCommand, S3ClientConfig } from '@aws-sdk/client-s3'
import {
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'
import { Tile, LegacyTile } from '../map/types'

export type IS3Component = {
  uploadTilesJson: (
    version: 'v1' | 'v2',
    tiles: Record<string, Partial<Tile> | Partial<LegacyTile>>
  ) => Promise<string>
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

    if (!bucketName) {
      componentLogger.warn(
        'Missing AWS bucket - S3 component will use stub implementation'
      )
      return createStubS3Component(componentLogger)
    }

    const s3Config: S3ClientConfig = {
      region,
      endpoint: endpoint || undefined,
    }

    // Only add credentials if they are provided
    if (accessKeyId && secretAccessKey) {
      s3Config.credentials = {
        accessKeyId,
        secretAccessKey,
      }
    }

    const s3Client = new S3Client(s3Config)

    async function uploadTilesJson(
      version: 'v1' | 'v2',
      tiles: Record<string, Partial<Tile> | Partial<LegacyTile>>
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

    return {
      uploadTilesJson,
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
  }
}
