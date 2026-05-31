import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Horizon } from 'stellar-sdk';
import { DATABASE_POOL } from '../database/database.module';

export interface BalanceResponse {
  merchant_id: string;
  on_chain_balance_usdc: string;
  pending_settlement_balance_usdc: string;
  total_balance_usdc: string;
}

@Injectable()
export class BalanceService {
  private horizonServer: Horizon.Server;

  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly config: ConfigService,
  ) {
    this.horizonServer = new Horizon.Server(this.config.getOrThrow<string>('HORIZON_URL'));
  }

  /**
   * Get merchant balance including on-chain and pending settlement amounts
   */
  async getMerchantBalance(merchantId: string): Promise<BalanceResponse> {
    // Get merchant's stellar address and muxed address info
    const merchantRow = await this.pool.query('SELECT stellar_address FROM merchants WHERE id=$1', [merchantId]);

    if (!merchantRow.rows[0]) {
      throw new Error('Merchant not found');
    }

    const stellarAddress = merchantRow.rows[0].stellar_address;

    // Get pending settlement balance from ledger entries
    const pendingRow = await this.pool.query(
      `SELECT COALESCE(SUM(net_usdc)::NUMERIC(18,7), '0') AS pending_balance
         FROM ledger_entries
        WHERE merchant_id=$1 AND settlement_id IS NULL`,
      [merchantId],
    );

    const pendingBalance = pendingRow.rows[0].pending_balance || '0';

    // Get on-chain balance from Stellar
    let onChainBalance = '0';
    if (stellarAddress) {
      try {
        const account = await this.horizonServer.loadAccount(stellarAddress);
        const assetCode = this.config.get<string>('STELLAR_ASSET_CODE', 'USDC');
        const assetIssuer = this.config.getOrThrow<string>('STELLAR_ASSET_ISSUER');

        // Find the balance for the specific asset
        const assetBalance = account.balances.find(
          (b) => b.asset_type === 'credit_alphanum4' || b.asset_type === 'credit_alphanum12'
            ? b.asset_code === assetCode && b.asset_issuer === assetIssuer
            : false,
        );

        onChainBalance = assetBalance?.balance || '0';
      } catch (error) {
        // If account doesn't exist on Horizon, balance is 0
        onChainBalance = '0';
      }
    }

    // Calculate total balance
    const totalBalance = (parseFloat(onChainBalance) + parseFloat(pendingBalance)).toFixed(7);

    return {
      merchant_id: merchantId,
      on_chain_balance_usdc: onChainBalance,
      pending_settlement_balance_usdc: pendingBalance,
      total_balance_usdc: totalBalance,
    };
  }
}
