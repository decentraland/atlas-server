import { ILoggerComponent } from '@well-known-components/interfaces'
import { ChainId } from '@dcl/schemas'
import { createTradesComponent } from '../../src/modules/trades/component'
import { IPgComponent } from '@well-known-components/pg-component'

describe('trades component', () => {
  let logs: ILoggerComponent
  let dappsReadDatabase: IPgComponent
  let mockQuery: jest.Mock

  beforeEach(() => {
    logs = {
      getLogger: () => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        log: jest.fn(),
      }),
    }

    mockQuery = jest.fn()
    dappsReadDatabase = {
      query: mockQuery,
      streamQuery: jest.fn(),
      getPool: jest.fn(),
      start: jest.fn(),
      stop: jest.fn(),
    }

    process.env.CHAIN_ID = ChainId.ETHEREUM_MAINNET.toString()
  })

  describe('getActiveTrades', () => {
    it('should return active trades from the database', async () => {
      const trades = await createTradesComponent({
        config: {} as any,
        logs,
        dappsReadDatabase,
      })

      const mockTrades = [
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

      const result = await trades.getActiveTrades()

      expect(result).toEqual(mockTrades)
      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][0].text).toContain('SELECT * FROM trades_with_status WHERE status = ')
    })

    it('should return empty array when query fails', async () => {
      const trades = await createTradesComponent({
        config: {} as any,
        logs,
        dappsReadDatabase,
      })

      mockQuery.mockRejectedValueOnce(new Error('Database error'))

      const result = await trades.getActiveTrades()

      expect(result).toEqual([])
      expect(mockQuery).toHaveBeenCalledTimes(1)
    })

    it('should filter by parcel and estate categories', async () => {
      const trades = await createTradesComponent({
        config: {} as any,
        logs,
        dappsReadDatabase,
      })

      mockQuery.mockResolvedValueOnce({ rows: [] })

      await trades.getActiveTrades()

      expect(mockQuery).toHaveBeenCalledTimes(1)
      expect(mockQuery.mock.calls[0][0].text).toContain("AND (nft.category = 'parcel' OR nft.category = 'estate')")
    })
  })
}) 