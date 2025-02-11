import { IBaseComponent } from '@well-known-components/interfaces'
import { AppComponents } from '../../types'
import { ContractName, getContract } from 'decentraland-transactions'
import { IPgComponent } from '@well-known-components/pg-component'
import { ChainId, ListingStatus, TradeType } from '@dcl/schemas'
import SQL from 'sql-template-strings'

export type Trade = {
  id: string
  created_at: string
  type: string
  signer: string
  contract_address_sent: string
  amount_received: string
  available: boolean
  sent_token_id: string
  status: string
}

export interface ITradesComponent extends IBaseComponent {
  getActiveTrades(): Promise<Trade[]>
}

export async function createTradesComponent(
  components: Pick<AppComponents, 'dappsReadDatabase' | 'config' | 'logs'>
): Promise<ITradesComponent> {
  const { dappsReadDatabase, logs } = components
  const logger = logs.getLogger('Trades component')

  async function getActiveTrades(): Promise<Trade[]> {
    try {
      const chainId = parseInt(
        process.env.CHAIN_ID || ChainId.ETHEREUM_MAINNET.toString()
      ) as ChainId

      const marketplaceEthereum = getContract(
        ContractName.OffChainMarketplace,
        chainId
      )
      const MARKETPLACE_SQUID_SCHEMA = 'squid_marketplace'
      const query = SQL`
      WITH trades_owner_ok AS (
        SELECT
          t.id
        FROM
          marketplace.trades t
          JOIN marketplace.trade_assets ta ON t.id = ta.trade_id
          -- The key part: join trade_assets_erc721 so we can get the token_id
          LEFT JOIN marketplace.trade_assets_erc721 erc721_asset ON ta.id = erc721_asset.asset_id
          -- Then join nft using (nft.token_id = erc721_asset.token_id::numeric)
          LEFT JOIN `
        .append(MARKETPLACE_SQUID_SCHEMA)
        .append(
          SQL`.nft nft ON (ta.contract_address = nft.contract_address
              AND ta.direction = 'sent'
              AND nft.token_id = erc721_asset.token_id::numeric)
        WHERE
          t.type IN ('public_item_order', 'public_nft_order')
          AND (nft.category = 'parcel' OR nft.category = 'estate')`
        )
        .append(
          SQL`
        GROUP BY
          t.id
        HAVING
          bool_and(ta.direction != 'sent' OR nft.owner_address = t.signer)
      )`.append(`, trades_with_status AS (
        SELECT 
            t.id,
            t.created_at,
            t.type,
            t.signer,
            MAX(CASE WHEN assets_with_values.direction = 'sent' THEN assets_with_values.contract_address END) AS contract_address_sent,
            MAX(CASE WHEN assets_with_values.direction = 'received' THEN assets_with_values.amount END) AS amount_received,
            MAX(CASE WHEN assets_with_values.direction = 'sent' THEN assets_with_values.available END) AS available,
            json_object_agg(
              assets_with_values.direction, 
              json_build_object(
                'contract_address', assets_with_values.contract_address,
                'direction', assets_with_values.direction,
                'beneficiary', assets_with_values.beneficiary,
                'extra', assets_with_values.extra,
                'token_id', assets_with_values.token_id,
                'item_id', assets_with_values.item_id,
                'amount', assets_with_values.amount,
                'creator', assets_with_values.creator
              )
            ) AS assets,
             /* CASE #1: Single NFT (if you only expect ONE 'sent' per trade) */
            MAX(assets_with_values.contract_address)
              FILTER (WHERE assets_with_values.direction = 'sent')
              AS sent_contract_address,
            MAX(assets_with_values.token_id)
              FILTER (WHERE assets_with_values.direction = 'sent')
              AS sent_token_id,
            CASE
              WHEN COUNT(CASE WHEN trade_status.action = 'cancelled' THEN 1 END) > 0 THEN 'cancelled'
              WHEN t.expires_at < now()::timestamptz(3) THEN '${
                ListingStatus.CANCELLED
              }'
              WHEN (
                (signer_signature_index.index IS NOT NULL AND signer_signature_index.index != (t.checks ->> 'signerSignatureIndex')::int)
                OR (signer_signature_index.index IS NULL AND (t.checks ->> 'signerSignatureIndex')::int != 0)
              ) THEN '${ListingStatus.CANCELLED}'
              WHEN (
                (contract_signature_index.index IS NOT NULL AND contract_signature_index.index != (t.checks ->> 'contractSignatureIndex')::int)
                OR (contract_signature_index.index IS NULL AND (t.checks ->> 'contractSignatureIndex')::int != 0)
              ) THEN '${ListingStatus.CANCELLED}'
              WHEN COUNT(CASE WHEN trade_status.action = 'executed' THEN 1 END) >= (t.checks ->> 'uses')::int then '${
                ListingStatus.SOLD
              }'
            ELSE '${ListingStatus.OPEN}'
            END AS status
          FROM marketplace.trades AS t
          JOIN trades_owner_ok ok ON t.id = ok.id
          JOIN (
            SELECT 
              ta.id, 
              ta.trade_id,
              ta.contract_address,
              ta.direction,
              ta.beneficiary,
              ta.extra,
              erc721_asset.token_id,
              erc20_asset.amount,
              item.creator,
              item.available,
              account.address as nft_owner,
              coalesce(nft.item_blockchain_id::text, item_asset.item_id) as item_id
          FROM marketplace.trade_assets AS ta
          LEFT JOIN marketplace.trade_assets_erc721 AS erc721_asset ON ta.id = erc721_asset.asset_id
          LEFT JOIN marketplace.trade_assets_erc20 AS erc20_asset ON ta.id = erc20_asset.asset_id
          LEFT JOIN marketplace.trade_assets_item AS item_asset ON ta.id = item_asset.asset_id
          LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.item AS item ON (ta.contract_address = item.collection_id AND item_asset.item_id::numeric = item.blockchain_id)
          LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.nft AS nft ON (ta.contract_address = nft.contract_address AND erc721_asset.token_id::numeric = nft.token_id)
          LEFT JOIN ${MARKETPLACE_SQUID_SCHEMA}.account as account ON (account.id = nft.owner_id)
        ) AS assets_with_values ON t.id = assets_with_values.trade_id
        LEFT JOIN squid_trades.trade AS trade_status ON trade_status.signature = t.hashed_signature
        LEFT JOIN squid_trades.signature_index AS signer_signature_index ON LOWER(signer_signature_index.address) = LOWER(t.signer)
        LEFT JOIN (
          SELECT *
          FROM squid_trades.signature_index signature_index
          WHERE LOWER(signature_index.address) IN ('${marketplaceEthereum.address.toLowerCase()}')
        ) AS contract_signature_index ON t.network = contract_signature_index.network
        WHERE t.type = '${TradeType.PUBLIC_ITEM_ORDER}' or t.type = '${
            TradeType.PUBLIC_NFT_ORDER
          }'
        GROUP BY t.id, t.type, t.created_at, t.network, t.chain_id, t.signer, t.checks, contract_signature_index.index, signer_signature_index.index
      )
      SELECT * FROM trades_with_status WHERE status = '${ListingStatus.OPEN}'
      `)
        )

      const result = await dappsReadDatabase.query<Trade>(query)
      return result.rows
    } catch (error) {
      logger.error(`Error fetching active trades: ${error}`)
      return []
    }
  }

  return {
    getActiveTrades,
    async start() {},
    async stop() {},
  }
}
