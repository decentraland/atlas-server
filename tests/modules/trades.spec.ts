import { ChainId } from '@dcl/schemas'
import { ILoggerComponent } from '@well-known-components/interfaces'
import { IPgComponent } from '@dcl/pg-component'
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
      withTransaction: jest.fn(),
      withAsyncContextTransaction: jest.fn(),
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

  /**
   * Pins the trade-status predicates this query depends on.
   *
   * Assertions on the query TEXT, not on results: there is no database harness here, so unlike
   * marketplace-server there is nowhere to seed indexer rows and assert a status. Each predicate below is
   * one that was missing and produced a wrong status on the map. Behavioural coverage of the same rules
   * lives in marketplace-server's trades-status integration spec.
   */
  describe('when building the active trades query', () => {
    let queryText: string

    beforeEach(async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 })
      await tradesComponent.getActiveTrades()
      queryText = mockQuery.mock.calls[0][0].text
    })

    it('should match a trade on either identifier, so a V3 cancellation resolves', () => {
      expect(queryText).toContain(
        'trade_status.signature = ANY(ARRAY[t.hashed_signature, t.trade_digest])'
      )
    })

    // cancelSignature takes no signer check, and the contract scopes the flag to keccak256(caller, digest)
    // while settlement reads keccak256(signer, digest), so a stranger cancelling is a no-op on chain.
    it('should count a cancellation only when the canceller is the trade signer', () => {
      expect(queryText).toContain(
        "trade_status.action = 'cancelled' AND LOWER(trade_status.caller) = LOWER(t.signer)"
      )
    })

    it('should count executed fills per indexer row rather than per joined asset row', () => {
      expect(queryText).toContain(
        "COUNT(DISTINCT trade_status.id) FILTER (WHERE trade_status.action = 'executed')"
      )
    })

    it('should scope the signer index to the marketplace that holds it', () => {
      expect(queryText).toContain(
        'signer_signature_index.contract = LOWER(t.contract)'
      )
    })

    it('should key the contract index on the trade marketplace', () => {
      expect(queryText).toContain(
        'contract_signature_index.address = LOWER(t.contract)'
      )
    })

    it('should no longer restrict the contract index to one hardcoded marketplace', () => {
      expect(queryText).not.toContain('WHERE LOWER(signature_index.address) IN')
    })

    // The indexer spells Polygon POLYGON while trades.network holds @dcl/schemas' MATIC.
    it('should translate the network name for both index joins', () => {
      expect(queryText.match(/THEN 'POLYGON'/g)).toHaveLength(2)
    })
  })

}) 