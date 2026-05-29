import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { z } from 'zod';
import { DATABASE_POOL } from '../database/database.module';

export type ApiKeyScope = 'read_only' | 'webhooks' | 'full_access';

const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
  scope: z.enum(['read_only', 'webhooks', 'full_access']),
  expires_at: z.string().datetime().optional(),
  allowed_ips: z.array(z.string().min(1)).optional(),
});

// Returns true if the given IP falls within the CIDR range (IPv4 only).
// For entries without a prefix length, performs an exact string match (works for both IPv4 and IPv6).
function ipMatchesCidr(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) return ip === cidr;

  const [range, bitsStr] = cidr.split('/');
  const prefixLen = parseInt(bitsStr, 10);
  const ipParts = ip.split('.').map(Number);
  const rangeParts = range.split('.').map(Number);

  if (ipParts.length !== 4 || rangeParts.length !== 4) return false;

  const ipNum = ipParts.reduce((acc, p) => ((acc << 8) | p) >>> 0, 0) >>> 0;
  const rangeNum = rangeParts.reduce((acc, p) => ((acc << 8) | p) >>> 0, 0) >>> 0;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;

  return (ipNum & mask) === (rangeNum & mask);
}

function isIpAllowed(clientIp: string | undefined, allowedIps: string[] | null): boolean {
  if (!allowedIps || allowedIps.length === 0) return true;
  if (!clientIp) return false;
  return allowedIps.some((cidr) => ipMatchesCidr(clientIp, cidr));
}

@Injectable()
export class ApiKeysService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(merchantId: string, input: unknown) {
    const dto = createApiKeySchema.parse(input);
    const raw = `sk_${randomBytes(32).toString('hex')}`;
    const prefix = raw.slice(0, 10);
    const hash = createHash('sha256').update(raw).digest('hex');
    const result = await this.pool.query(
      `INSERT INTO api_keys (merchant_id, name, key_hash, key_prefix, scope, expires_at, allowed_ips)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, name, key_prefix, scope, expires_at, allowed_ips, created_at`,
      [merchantId, dto.name, hash, prefix, dto.scope, dto.expires_at ?? null, dto.allowed_ips ?? null],
    );
    return { ...result.rows[0], key: raw };
  }

  async list(merchantId: string) {
    const result = await this.pool.query(
      `SELECT id, name, key_prefix, scope, last_used_at, expires_at, revoked_at, allowed_ips, created_at
         FROM api_keys WHERE merchant_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC`,
      [merchantId],
    );
    return result.rows;
  }

  async revoke(merchantId: string, id: string) {
    const result = await this.pool.query(
      `UPDATE api_keys SET revoked_at=NOW()
        WHERE id=$1 AND merchant_id=$2 AND revoked_at IS NULL
        RETURNING id, revoked_at`,
      [id, merchantId],
    );
    return result.rows[0] ?? null;
  }

  async validate(rawKey: string, clientIp?: string): Promise<{ merchantId: string; scope: ApiKeyScope }> {
    const hash = createHash('sha256').update(rawKey).digest('hex');
    const result = await this.pool.query(
      `UPDATE api_keys
          SET last_used_at=NOW()
        WHERE key_hash=$1
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
        RETURNING merchant_id, scope, allowed_ips`,
      [hash],
    );
    if (!result.rows[0]) throw new UnauthorizedException('Invalid or expired API key');

    const { merchant_id, scope, allowed_ips } = result.rows[0];
    if (!isIpAllowed(clientIp, allowed_ips)) {
      throw new ForbiddenException('Client IP address is not permitted for this API key');
    }

    return { merchantId: merchant_id, scope };
  }
}
