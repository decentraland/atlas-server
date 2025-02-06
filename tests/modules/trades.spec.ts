import { ChainId } from '@dcl/schemas'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '@well-known-components/pg-component'
import { createTradesComponent, ITradesComponent } from '../../src/modules/trades/component'

describe('trades component', () => {
  let loggerComponentMock: ILoggerComponent
  let dappsReadDatabase: IPgComponent
  let mockQuery: jest.Mock
  let tradesComponent: ITradesComponent

  beforeEach(async () => {
    mockQuery = jest.fn()
    loggerComponentMock = {
      getLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        log: jest.fn(),
      }),
    }

    dappsReadDatabase = {
      query: mockQuery,
      streamQuery: jest.fn(),
      getPool: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    }

    process.env.CHAIN_ID = ChainId.ETHEREUM_MAINNET.toString()

    tradesComponent = await createTradesComponent({
      config: {} as any,
      logs: loggerComponentMock,
      dappsReadDatabase,
    })
  })

  describe('when getting active trades', () => {
    describe('and the query is successful', () => {
      let mockTrades: any[]
      let result: any[]

      beforeEach(async () => {
        mockTrades = [
          {
            id: '1',
            created_at: '2024-02-06T10:00:00Z',
            type: 'public_nft_order',
            signer: '0x123',
            contract_address_sent: '0x456',
            amount_received: '1000000000000000000',
            available: true,
            sent_token_id: '789',
            status: 'open',
          },
        ]

        mockQuery.mockResolvedValueOnce({ rows: mockTrades })
        result = await tradesComponent.getActiveTrades()
      })

      it('should return active trades from the database', () => {
        expect(result).toEqual(mockTrades)
      })

      it('should call the query once with the correct parameters', () => {
        expect(mockQuery).toHaveBeenCalledTimes(1)
        expect(mockQuery.mock.calls[0][0].text).toContain('SELECT * FROM trades_with_status WHERE status = ')
      })

      it('should filter by parcel and estate categories', () => {
        expect(mockQuery.mock.calls[0][0].text).toContain("AND (nft.category = 'parcel' OR nft.category = 'estate')")
      })
    })

    describe('and the query fails', () => {
      let result: any[]

      beforeEach(async () => {
        mockQuery.mockRejectedValueOnce(new Error('Database error'))
        result = await tradesComponent.getActiveTrades()
      })

      it('should return an empty array', () => {
        expect(result).toEqual([])
      })

      it('should have attempted to query once', () => {
        expect(mockQuery).toHaveBeenCalledTimes(1)
      })
    })
  })
}) 