import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';
import { DATABASE_POOL } from '../database/database.module';

const updateMerchantSchema = z.object({
  name: z.string().min(1).optional(),
  stellar_address: z.string().regex(/^G[A-Z0-9]{10,}$/).optional(),
  settlement_cadence: z.enum(['daily', 'weekly']).optional(),
  daily_spend_limit_usdc: z.number().positive().nullable().optional(),
  monthly_spend_limit_usdc: z.number().positive().nullable().optional(),
  settlement_scheduled_at: z.string().datetime().nullable().optional(),
  test_mode: z.boolean().optional(),
  min_invoice_usdc: z.string().regex(/^\d+(\.\d{1,7})?$/).optional(),
  max_invoice_usdc: z.string().regex(/^\d+(\.\d{1,7})?$/).optional(),
  unpaid_invoice_ttl_minutes: z.number().int().positive().max(10080).nullable().optional(),
});

@Injectable()
export class MerchantsService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(input: { email: string; name: string; passwordHash: string }) {
    const result = await this.pool.query(
      `INSERT INTO merchants (email, name, password_hash, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING *`,
      [input.email, input.name, input.passwordHash],
    );
    return result.rows[0];
  }

  async findByEmail(email: string) {
    const result = await this.pool.query('SELECT * FROM merchants WHERE email=$1', [email]);
    return result.rows[0] ?? null;
  }

  async findOne(id: string) {
    const result = await this.pool.query('SELECT * FROM merchants WHERE id=$1', [id]);
    if (!result.rows[0]) throw new NotFoundException('Merchant not found');
    return result.rows[0];
  }

  async onboarding(id: string) {
    const merchant = await this.findOne(id);
    const [invoiceRow, webhookRow, scheduleRow] = await Promise.all([
      this.pool.query('SELECT 1 FROM invoices WHERE merchant_id=$1 LIMIT 1', [id]),
      this.pool.query('SELECT 1 FROM webhooks WHERE merchant_id=$1 AND active=true LIMIT 1', [id]),
      this.pool.query('SELECT 1 FROM recurring_schedules WHERE merchant_id=$1 LIMIT 1', [id]),
    ]);

    const steps = [
      { key: 'profile_complete', label: 'Complete merchant profile', done: !!(merchant.name && merchant.stellar_address) },
      { key: 'kyb_verified', label: 'KYB verification', done: !!merchant.kyb_verified_at },
      { key: 'first_invoice', label: 'Create first invoice', done: invoiceRow.rowCount! > 0 },
      { key: 'webhook_configured', label: 'Configure a webhook', done: webhookRow.rowCount! > 0 },
      { key: 'schedule_created', label: 'Set up a recurring schedule', done: scheduleRow.rowCount! > 0 },
    ];

    const completed = steps.filter((s) => s.done).length;
    return { completed, total: steps.length, percent: Math.round((completed / steps.length) * 100), steps };
  }

  async updateKycStatus(id: string, status: 'approved' | 'rejected') {
    const result = await this.pool.query(
      `UPDATE merchants SET kyc_status=$2, kyb_verified_at=CASE WHEN $2='approved' THEN NOW() ELSE NULL END, updated_at=NOW()
       WHERE id=$1 RETURNING *`,
      [id, status],
    );
    if (!result.rows[0]) throw new NotFoundException('Merchant not found');
    return result.rows[0];
  }

  async update(id: string, input: unknown) {
    const dto = updateMerchantSchema.parse(input);
    const current = await this.findOne(id);

    const result = await this.pool.query(
      `UPDATE merchants
         SET name=$2,
             stellar_address=$3,
             settlement_cadence=COALESCE($4, settlement_cadence),
             daily_spend_limit_usdc=COALESCE($5, daily_spend_limit_usdc),
             monthly_spend_limit_usdc=COALESCE($6, monthly_spend_limit_usdc),
             settlement_scheduled_at=COALESCE($7, settlement_scheduled_at),
             test_mode=COALESCE($8, test_mode),
             min_invoice_usdc=COALESCE($9, min_invoice_usdc),
             max_invoice_usdc=COALESCE($10, max_invoice_usdc),
             unpaid_invoice_ttl_minutes=COALESCE($11, unpaid_invoice_ttl_minutes),
             updated_at=NOW()
       WHERE id=$1
       RETURNING *`,
      [
        id,
        dto.name ?? current.name,
        dto.stellar_address ?? current.stellar_address,
        dto.settlement_cadence ?? null,
        dto.daily_spend_limit_usdc ?? null,
        dto.monthly_spend_limit_usdc ?? null,
        dto.settlement_scheduled_at ?? null,
        dto.test_mode ?? null,
        dto.min_invoice_usdc ?? null,
        dto.max_invoice_usdc ?? null,
        dto.unpaid_invoice_ttl_minutes ?? null,
      ],
    );

    return result.rows[0];
  }
}

