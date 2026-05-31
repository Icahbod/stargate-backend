import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';
import { KmsSignerService } from '../stellar/kms-signer.service';

@Injectable()
export class SettlementService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool, private readonly kms: KmsSignerService) {}

  async createDailySettlements() {
    // Only settle merchants without a deferred schedule, or whose deferred time has passed
    const merchants = await this.pool.query(
      `SELECT merchant_id, SUM(net_usdc)::NUMERIC(18,7) AS amount
         FROM ledger_entries
        WHERE settlement_id IS NULL
        GROUP BY merchant_id
       HAVING SUM(net_usdc)::NUMERIC(18,7) >= 1.00`,
    );
    for (const merchant of merchants.rows) {
      // Check if pending settlement already exists for this merchant
      const existing = await this.pool.query(
        `SELECT id FROM settlements WHERE merchant_id=$1 AND status='pending'`,
        [merchant.merchant_id],
      );
      if (existing.rows.length > 0) continue;

      // Create settlement and mark ledger entries
      const settlement = await this.pool.query(
        `INSERT INTO settlements (merchant_id, amount_usdc, status) VALUES ($1,$2,'pending') RETURNING id`,
        [merchant.merchant_id, merchant.amount],
      );
      // Clear the one-time deferred schedule after triggering
      await this.pool.query(
        `UPDATE merchants SET settlement_scheduled_at=NULL WHERE id=$1 AND settlement_scheduled_at IS NOT NULL`,
        [merchant.merchant_id],
      );
      await this.pool.query(
        `UPDATE ledger_entries SET settlement_id=$1 WHERE merchant_id=$2 AND settlement_id IS NULL`,
        [settlement.rows[0].id, merchant.merchant_id],
      );
    }
    return merchants.rowCount;
  }

  async signSettlementDigest(digest: Uint8Array) {
    return this.kms.signDigest(digest);
  }
}
