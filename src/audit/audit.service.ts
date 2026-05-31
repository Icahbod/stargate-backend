import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

const execFileAsync = promisify(execFile);

export type CheckResult = { name: string; status: 'pass' | 'fail'; detail?: string };

const REQUIRED_ENV = [
  'NODE_ENV',
  'STELLAR_NETWORK',
  'RUN_MIGRATIONS_ON_STARTUP',
  'DATABASE_URL',
  'DATABASE_DIRECT_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'WEBHOOK_SIGNING_SECRET',
  'ENCRYPTION_KEY',
  'HORIZON_URL',
  'SOROBAN_RPC_URL',
  'STELLAR_ASSET_ISSUER',
  'PLATFORM_TREASURY_PUBLIC_KEY',
  'INVOICE_CONTRACT_ID',
] as const;

const REQUIRED_VALUES: Partial<Record<(typeof REQUIRED_ENV)[number], string>> = {
  NODE_ENV: 'production',
  STELLAR_NETWORK: 'mainnet',
  RUN_MIGRATIONS_ON_STARTUP: 'false',
};

export type AuditAction =
  | 'api_key_created'
  | 'api_key_rotated'
  | 'api_key_deactivated'
  | 'webhook_created'
  | 'webhook_rotated'
  | 'webhook_deactivated'
  | 'webhook_retried';

export type ResourceType = 'api_key' | 'webhook';

@Injectable()
export class AuditService {
  constructor(private readonly config: ConfigService, @Inject(DATABASE_POOL) private readonly pool?: Pool) {}

  async run(): Promise<{ status: 'pass' | 'fail'; checks: CheckResult[] }> {
    const checks: CheckResult[] = [
      ...this.checkEnvVars(),
      await this.checkSecretScan(),
      await this.checkNpmAudit(),
      await this.checkEndpoint('api_health', this.config.get('API_URL', 'http://localhost:3000') + '/health'),
      await this.checkEndpoint('api_rpc_health', this.config.get('API_URL', 'http://localhost:3000') + '/health/rpc'),
    ];
    const status = checks.every((c) => c.status === 'pass') ? 'pass' : 'fail';
    return { status, checks };
  }

  private checkEnvVars(): CheckResult[] {
    return REQUIRED_ENV.map((name) => {
      const value = process.env[name];
      if (!value) return { name: `env:${name}`, status: 'fail', detail: `${name} is not set` };
      const expected = REQUIRED_VALUES[name];
      if (expected && value !== expected) {
        return { name: `env:${name}`, status: 'fail', detail: `${name} must be '${expected}', got '${value}'` };
      }
      return { name: `env:${name}`, status: 'pass' };
    });
  }

  private async checkSecretScan(): Promise<CheckResult> {
    const pattern = '(sk_live_[A-Za-z0-9_=-]{16,}|pk_live_[A-Za-z0-9_=-]{16,}|whsec_[A-Za-z0-9_=-]{16,}|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY)';
    try {
      const { stdout } = await execFileAsync('git', ['grep', '-nE', pattern, '--', ':!node_modules', ':!dist', ':!coverage'], { cwd: process.cwd() });
      if (stdout.trim()) return { name: 'secret_scan', status: 'fail', detail: 'Possible secret found in tracked files' };
    } catch (err: any) {
      // exit code 1 means no matches — that's a pass
      if (err.code !== 1) return { name: 'secret_scan', status: 'fail', detail: err.message };
    }
    return { name: 'secret_scan', status: 'pass' };
  }

  private async checkNpmAudit(): Promise<CheckResult> {
    try {
      await execFileAsync('npm', ['audit', '--audit-level=high'], { cwd: process.cwd() });
      return { name: 'npm_audit', status: 'pass' };
    } catch (err: any) {
      return { name: 'npm_audit', status: 'fail', detail: err.stdout ?? err.message };
    }
  }

  private async checkEndpoint(name: string, url: string): Promise<CheckResult> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      return res.ok ? { name, status: 'pass' } : { name, status: 'fail', detail: `HTTP ${res.status}` };
    } catch (err: any) {
      return { name, status: 'fail', detail: err.message };
    }
  }

  async log(
    merchantId: string,
    action: AuditAction,
    resourceType: ResourceType,
    resourceId: string,
    options?: {
      actorIp?: string;
      actorEmail?: string;
      metadata?: Record<string, any>;
    },
  ) {
    if (!this.pool) throw new Error('Database pool is not configured');
    await this.pool.query(
      `INSERT INTO audit_logs (merchant_id, action, resource_type, resource_id, actor_ip, actor_email, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        merchantId,
        action,
        resourceType,
        resourceId,
        options?.actorIp ?? null,
        options?.actorEmail ?? null,
        options?.metadata ? JSON.stringify(options.metadata) : null,
      ],
    );
  }

  async list(merchantId: string, limit: number = 100, offset: number = 0) {
    if (!this.pool) throw new Error('Database pool is not configured');
    const result = await this.pool.query(
      `SELECT * FROM audit_logs 
       WHERE merchant_id = $1 
       ORDER BY created_at DESC 
       LIMIT $2 OFFSET $3`,
      [merchantId, limit, offset],
    );
    return result.rows;
  }
}
