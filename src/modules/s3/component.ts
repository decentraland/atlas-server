import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import {
  IConfigComponent,
  ILoggerComponent,
} from '@well-known-components/interfaces'

export type IS3Component = {
  uploadTilesJson: (version: 'v1' | 'v2', tiles: any) => Promise<string>
}

export async function createS3Component(components: {
  config: IConfigComponent
  logs: ILoggerComponent
}): Promise<IS3Component> {
  const { config, logs } = components
  const componentLogger = logs.getLogger('S3 component')

  try {
    const region = await config.getString('AWS_REGION')
    const accessKeyId = await config.getString('AWS_ACCESS_KEY_ID')
    const secretAccessKey = await config.getString('AWS_SECRET_ACCESS_KEY')
    const bucketName = await config.getString('AWS_S3_BUCKET')

    if (!region || !accessKeyId || !secretAccessKey || !bucketName) {
      componentLogger.warn(
        'Missing AWS configuration - S3 component will use stub implementation'
      )
      return createStubS3Component(componentLogger)
    }

    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    })

    async function uploadTilesJson(
      version: 'v1' | 'v2',
      tiles: any
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

        const fileUrl = `https://${bucketName}.s3.amazonaws.com/${key}`
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
