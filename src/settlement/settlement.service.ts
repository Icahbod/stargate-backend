import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
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
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Check if pending settlement already exists for this merchant
        const existing = await client.query(
          `SELECT id FROM settlements WHERE merchant_id=$1 AND status='pending'`,
          [merchant.merchant_id],
        );
        if (existing.rows.length > 0) {
          await client.query('COMMIT');
          continue;
        }

        // Create settlement and mark ledger entries
        const settlement = await client.query(
          `INSERT INTO settlements (merchant_id, amount_usdc, status) VALUES ($1,$2,'pending') RETURNING id`,
          [merchant.merchant_id, merchant.amount],
        );
        // Clear the one-time deferred schedule after triggering
        await client.query(
          `UPDATE merchants SET settlement_scheduled_at=NULL WHERE id=$1 AND settlement_scheduled_at IS NOT NULL`,
          [merchant.merchant_id],
        );
        await client.query(
          `UPDATE ledger_entries SET settlement_id=$1 WHERE merchant_id=$2 AND settlement_id IS NULL`,
          [settlement.rows[0].id, merchant.merchant_id],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    return merchants.rowCount;
  }

  async signSettlementDigest(digest: Uint8Array) {
    return this.kms.signDigest(digest);
  }
}
