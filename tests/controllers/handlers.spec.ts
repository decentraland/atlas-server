import { IFeaturesComponent } from '@well-known-components/features-component'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { EventEmitter } from 'events'
import { IMapComponent } from '../../src/modules/map/types'
import {
  createTilesRequestHandler,
  createLegacyTilesRequestHandler,
} from '../../src/controllers/handlers'

type HandlerResponse = {
  status: number
  headers?: Record<string, string>
  body?: string | Record<string, unknown>
}

describe('Tiles Request Handlers', () => {
  let mapComponentMock: IMapComponent
  let featuresComponentMock: IFeaturesComponent
  let loggerComponentMock: ILoggerComponent
  let loggerWarnMock: jest.Mock
  const s3Url = 'https://s3.example.com/tiles'

  beforeEach(() => {
    loggerWarnMock = jest.fn()
    loggerComponentMock = {
      getLogger: () => ({
        warn: loggerWarnMock,
        info: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        log: jest.fn(),
      }),
    }

    const events = new EventEmitter()
    mapComponentMock = {
      isReady: jest.fn(),
      getTiles: jest.fn().mockResolvedValue({}),
      getLastUploadedTilesUrl: jest.fn().mockReturnValue({
        v1: `${s3Url}/v1`,
        v2: `${s3Url}/v2`,
      }),
      getLastUpdatedAt: jest.fn().mockReturnValue(Date.now()),
      events,
      getParcel: jest.fn(),
      getEstate: jest.fn(),
      getDissolvedEstate: jest.fn(),
      getToken: jest.fn(),
    }

    featuresComponentMock = {
      getIsFeatureEnabled: jest.fn(),
      getEnvFeature: jest.fn(),
      getFeatureVariant: jest.fn(),
    }
  })

  describe('createTilesRequestHandler', () => {
    describe('when map is not ready', () => {
      beforeEach(() => {
        mapComponentMock.isReady = jest.fn().mockReturnValue(false)
      })

      describe('and S3 redirect feature is OFF', () => {
        beforeEach(() => {
          featuresComponentMock.getIsFeatureEnabled = jest.fn().mockResolvedValue(false)
        })

        it('should return 503 status', async () => {
          const handler = createTilesRequestHandler({ 
            map: mapComponentMock, 
            features: featuresComponentMock,
            logs: loggerComponentMock
          })
          const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
          expect(result.status).toBe(503)
          expect(result.body).toBe('Not ready')
        })
      })

      describe('and S3 redirect feature is ON', () => {
        beforeEach(() => {
          featuresComponentMock.getIsFeatureEnabled = jest.fn().mockResolvedValue(true)
        })

        describe('and S3 URL is available', () => {
          it('should return 301 redirect to S3', async () => {
            const handler = createTilesRequestHandler({ 
              map: mapComponentMock, 
              features: featuresComponentMock,
              logs: loggerComponentMock
            })
            const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
            expect(result.status).toBe(301)
            expect(result.headers?.location).toBe(`${s3Url}/v2`)
          })
        })

        describe('and S3 URL is not available', () => {
          beforeEach(() => {
            mapComponentMock.getLastUploadedTilesUrl = jest.fn().mockReturnValue({})
          })

          it('should return 503 status since map is not ready and no S3 fallback', async () => {
            const handler = createTilesRequestHandler({ 
              map: mapComponentMock, 
              features: featuresComponentMock,
              logs: loggerComponentMock
            })
            const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
            expect(result.status).toBe(503)
            expect(result.body).toBe('Not ready')
            expect(loggerWarnMock).toHaveBeenCalledWith('No S3 file available')
          })
        })
      })
    })

    describe('when map is ready', () => {
      beforeEach(() => {
        mapComponentMock.isReady = jest.fn().mockReturnValue(true)
      })

      describe('and S3 redirect feature is ON', () => {
        beforeEach(() => {
          featuresComponentMock.getIsFeatureEnabled = jest.fn().mockResolvedValue(true)
        })

        describe('and S3 URL is available', () => {
          it('should return 301 redirect to S3', async () => {
            const handler = createTilesRequestHandler({ 
              map: mapComponentMock, 
              features: featuresComponentMock,
              logs: loggerComponentMock
            })
            const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
            expect(result.status).toBe(301)
            expect(result.headers?.location).toBe(`${s3Url}/v2`)
          })
        })

        describe('and S3 URL is not available', () => {
          beforeEach(() => {
            mapComponentMock.getLastUploadedTilesUrl = jest.fn().mockReturnValue({})
          })

          it('should serve tiles from map and log warning', async () => {
            const handler = createTilesRequestHandler({ 
              map: mapComponentMock, 
              features: featuresComponentMock,
              logs: loggerComponentMock
            })
            const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
            expect(result.status).toBe(200)
            expect(loggerWarnMock).toHaveBeenCalledWith('No S3 file available')
            expect(result.headers?.['content-type']).toBe('application/json')
          })
        })
      })

      describe('and S3 redirect feature is OFF', () => {
        beforeEach(() => {
          featuresComponentMock.getIsFeatureEnabled = jest.fn().mockResolvedValue(false)
        })

        it('should serve tiles from map', async () => {
          const handler = createTilesRequestHandler({ 
            map: mapComponentMock, 
            features: featuresComponentMock,
            logs: loggerComponentMock
          })
          const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
          expect(result.status).toBe(200)
          expect(result.headers?.['content-type']).toBe('application/json')
        })
      })
    })
  })

  describe('createLegacyTilesRequestHandler', () => {
    describe('when map is not ready', () => {
      beforeEach(() => {
        mapComponentMock.isReady = jest.fn().mockReturnValue(false)
      })

      describe('and S3 redirect feature is OFF', () => {
        beforeEach(() => {
          featuresComponentMock.getIsFeatureEnabled = jest.fn().mockResolvedValue(false)
        })

        it('should return 503 status', async () => {
          const handler = createLegacyTilesRequestHandler({ 
            map: mapComponentMock, 
            features: featuresComponentMock,
            logs: loggerComponentMock
          })
          const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
          expect(result.status).toBe(503)
          expect(result.body).toBe('Not ready')
        })
      })

      describe('and S3 redirect feature is ON', () => {
        beforeEach(() => {
          featuresComponentMock.getIsFeatureEnabled = jest.fn().mockResolvedValue(true)
        })

        describe('and S3 URL is available', () => {
          it('should return 301 redirect to S3', async () => {
            const handler = createLegacyTilesRequestHandler({ 
              map: mapComponentMock, 
              features: featuresComponentMock,
              logs: loggerComponentMock
            })
            const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
            expect(result.status).toBe(301)
            expect(result.headers?.location).toBe(`${s3Url}/v1`)
          })
        })

        describe('and S3 URL is not available', () => {
          beforeEach(() => {
            mapComponentMock.getLastUploadedTilesUrl = jest.fn().mockReturnValue({})
          })

          it('should return 503 status since map is not ready and no S3 fallback', async () => {
            const handler = createLegacyTilesRequestHandler({ 
              map: mapComponentMock, 
              features: featuresComponentMock,
              logs: loggerComponentMock
            })
            const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
            expect(result.status).toBe(503)
            expect(result.body).toBe('Not ready')
            expect(loggerWarnMock).toHaveBeenCalledWith('No S3 file available')
          })
        })
      })
    })

    describe('when map is ready', () => {
      beforeEach(() => {
        mapComponentMock.isReady = jest.fn().mockReturnValue(true)
      })

      describe('and S3 redirect feature is ON', () => {
        beforeEach(() => {
          featuresComponentMock.getIsFeatureEnabled = jest.fn().mockResolvedValue(true)
        })

        describe('and S3 URL is available', () => {
          it('should return 301 redirect to S3', async () => {
            const handler = createLegacyTilesRequestHandler({ 
              map: mapComponentMock, 
              features: featuresComponentMock,
              logs: loggerComponentMock
            })
            const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
            expect(result.status).toBe(301)
            expect(result.headers?.location).toBe(`${s3Url}/v1`)
          })
        })

        describe('and S3 URL is not available', () => {
          beforeEach(() => {
            mapComponentMock.getLastUploadedTilesUrl = jest.fn().mockReturnValue({})
          })

          it('should serve tiles from map and log warning', async () => {
            const handler = createLegacyTilesRequestHandler({ 
              map: mapComponentMock, 
              features: featuresComponentMock,
              logs: loggerComponentMock
            })
            const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
            expect(result.status).toBe(200)
            expect(loggerWarnMock).toHaveBeenCalledWith('No S3 file available')
            expect(result.headers?.['content-type']).toBe('application/json')
          })
        })
      })

      describe('and S3 redirect feature is OFF', () => {
        beforeEach(() => {
          featuresComponentMock.getIsFeatureEnabled = jest.fn().mockResolvedValue(false)
        })

        it('should serve tiles from map', async () => {
          const handler = createLegacyTilesRequestHandler({ 
            map: mapComponentMock, 
            features: featuresComponentMock,
            logs: loggerComponentMock
          })
          const result = await handler({ url: new URL('http://localhost') }) as HandlerResponse
          expect(result.status).toBe(200)
          expect(result.headers?.['content-type']).toBe('application/json')
        })
      })
    })
  })
})
