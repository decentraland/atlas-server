import { rootRequestHandler } from '../../src/controllers/handlers'

describe('rootRequestHandler', () => {
  it('returns a documentation link for the root path', async () => {
    const response = await rootRequestHandler()
    const body = JSON.parse(response.body)

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('application/json')
    expect(body.ok).toBe(true)
    expect(body.documentation).toBe(
      'https://github.com/decentraland/atlas-server#endpoints'
    )
    expect(body.endpoints).toContain('/v2/tiles')
    expect(body.endpoints).toContain('/v2/ready')
  })
})
