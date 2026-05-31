import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';
import { DATABASE_POOL } from '../database/database.module';

const createSchema = z.object({
  recipient: z.string().min(1),
  amount_usdc: z.union([z.number().positive(), z.string().regex(/^\d+(\.\d{1,7})?$/)]).transform(String),
  interval: z.enum(['daily', 'weekly', 'monthly']),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['active', 'paused', 'cancelled']).optional(),
});

function nextRunAt(interval: string) {
  const d = new Date();
  if (interval === 'daily') d.setDate(d.getDate() + 1);
  else if (interval === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

@Injectable()
export class SchedulesService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async create(merchantId: string, input: unknown) {
    /**
     * Create a recurring schedule for a merchant.
     * @param merchantId - owning merchant id
     * @param input - schedule creation payload
     */
    const dto = createSchema.parse(input);
    const result = await this.pool.query(
      `INSERT INTO recurring_schedules (merchant_id, recipient, amount_usdc, interval, next_run_at)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [merchantId, dto.recipient, dto.amount_usdc, dto.interval, nextRunAt(dto.interval)],
    );
    return result.rows[0];
  }

  async list(merchantId: string) {
    /**
     * List recurring schedules for a merchant.
     * @param merchantId - owning merchant id
     */
    const result = await this.pool.query(
      `SELECT * FROM recurring_schedules WHERE merchant_id=$1 ORDER BY created_at DESC`,
      [merchantId],
    );
    return result.rows;
  }

  async get(merchantId: string, id: string) {
    /**
     * Retrieve a recurring schedule by id for a merchant.
     * @param merchantId - owning merchant id
     * @param id - schedule id
     */
    const result = await this.pool.query(
      `SELECT * FROM recurring_schedules WHERE id=$1 AND merchant_id=$2`,
      [id, merchantId],
    );
    if (!result.rows[0]) throw new NotFoundException('Schedule not found');
    return result.rows[0];
  }

  async update(merchantId: string, id: string, input: unknown) {
    /**
     * Update a recurring schedule.
     * @param merchantId - owning merchant id
     * @param id - schedule id
     * @param input - update payload
     */
    const current = await this.get(merchantId, id);
    const dto = updateSchema.parse(input);
    const interval = dto.interval ?? current.interval;
    const result = await this.pool.query(
      `UPDATE recurring_schedules
          SET recipient=COALESCE($3, recipient),
              amount_usdc=COALESCE($4, amount_usdc),
              interval=$5,
              status=COALESCE($6, status),
              next_run_at=CASE WHEN $7 THEN $8::timestamptz ELSE next_run_at END,
              updated_at=NOW()
        WHERE id=$1 AND merchant_id=$2
        RETURNING *`,
      [id, merchantId, dto.recipient ?? null, dto.amount_usdc ?? null, interval,
       dto.status ?? null, !!dto.interval, nextRunAt(interval)],
    );
    return result.rows[0];
  }

  async remove(merchantId: string, id: string) {
    /**
     * Cancel a recurring schedule.
     * @param merchantId - owning merchant id
     * @param id - schedule id
     */
    const result = await this.pool.query(
      `UPDATE recurring_schedules SET status='cancelled', updated_at=NOW()
        WHERE id=$1 AND merchant_id=$2 RETURNING *`,
      [id, merchantId],
    );
    if (!result.rows[0]) throw new NotFoundException('Schedule not found');
    return result.rows[0];
  }
}
