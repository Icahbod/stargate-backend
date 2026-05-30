import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import { DATABASE_POOL } from '../database/database.module';

export type ApiKeyScope = 'read_only' | 'webhooks' | 'full_access';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(['read_only', 'webhooks', 'full_access']),
  expires_at: z.string().datetime().optional(),
});

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(merchantId: string, input: unknown) {
    /**
     * Create a new API key for a merchant and return the raw key.
     * @param merchantId - owning merchant id
     * @param input - key creation payload
     */
    const dto = createApiKeySchema.parse(input);
    const raw = `sk_${randomBytes(32).toString('hex')}`;
    const prefix = raw.slice(0, 10);
    const hash = createHash('sha256').update(raw).digest('hex');
    const result = await this.pool.query(
      `INSERT INTO api_keys (merchant_id, name, key_hash, key_prefix, scope, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, name, key_prefix, scope, expires_at, created_at`,
      [merchantId, dto.name, hash, prefix, dto.scope, dto.expires_at ?? null],
    );
    return { ...result.rows[0], key: raw };
  }

  async list(merchantId: string) {
    /**
     * List active API keys for a merchant.
     * @param merchantId - owning merchant id
     */
    const result = await this.pool.query(
      `SELECT id, name, key_prefix, scope, last_used_at, expires_at, revoked_at, created_at
         FROM api_keys WHERE merchant_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [merchantId],
    );
    return result.rows;
  }

  async revoke(merchantId: string, id: string) {
    /**
     * Revoke an API key.
     * @param merchantId - owning merchant id
     * @param id - api key id to revoke
     */
    const result = await this.pool.query(
      `UPDATE api_keys SET revoked_at=NOW()
        WHERE id=$1 AND merchant_id=$2 AND revoked_at IS NULL
        RETURNING id, revoked_at`,
      [id, merchantId],
    );
    return result.rows[0] ?? null;
  }

  async validate(rawKey: string): Promise<{ merchantId: string; scope: ApiKeyScope }> {
    /**
     * Validate a raw API key and return its merchant and scope.
     * @param rawKey - raw API key string provided by a client
     */
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const result = await this.pool.query(
      `UPDATE api_keys
          SET last_used_at=NOW()
        WHERE key_hash=$1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        RETURNING merchant_id, scope`,
      [hash],
    );
    if (!result.rows[0]) throw new UnauthorizedException('Invalid or expired API key');
    return { merchantId: result.rows[0].merchant_id, scope: result.rows[0].scope };
  }
}
