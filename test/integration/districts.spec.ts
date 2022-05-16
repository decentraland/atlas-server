import { District } from '../../src/modules/district/types'
import { test } from '../components'
import Sinon from 'sinon'

test('test districts response', function ({ components, stubComponents }) {
  it('responds /v2/districts', async () => {
    const { localFetch } = components
    const { district } = stubComponents

    const districtsResult: District[] = [
      { id: '', description: '', name: 'dname', parcels: [], totalParcels: 0 },
    ]

    district.getDistricts.returns(districtsResult)

    const r = await localFetch.fetch('/v2/districts')

    Sinon.assert.calledOnce(district.getDistricts)

    expect(r.status).toEqual(200)
    expect(await r.json()).toEqual({ ok: true, data: districtsResult })
  })
})
