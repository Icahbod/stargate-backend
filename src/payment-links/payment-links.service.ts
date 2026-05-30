import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

export type LinkEventType = 'view' | 'attempt' | 'conversion';

@Injectable()
export class PaymentLinksService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async trackEvent(invoiceId: string, eventType: LinkEventType, meta: { ipHash?: string; userAgent?: string }) {
    /**
     * Record a payment-link related event for an invoice.
     * @param invoiceId - invoice id
     * @param eventType - event type (view/attempt/conversion)
     * @param meta - optional metadata such as ipHash and userAgent
     */
    // Verify invoice exists and get merchant_id
    const inv = await this.pool.query('SELECT merchant_id FROM invoices WHERE id=$1', [invoiceId]);
    if (!inv.rows[0]) throw new NotFoundException('Invoice not found');

    await this.pool.query(
      `INSERT INTO payment_link_events (invoice_id, merchant_id, event_type, ip_hash, user_agent)
       VALUES ($1,$2,$3,$4,$5)`,
      [invoiceId, inv.rows[0].merchant_id, eventType, meta.ipHash ?? null, meta.userAgent ?? null],
    );
  }

  async getAnalytics(merchantId: string, invoiceId: string) {
    /**
     * Get aggregated analytics for a specific payment link (invoice).
     * @param merchantId - owning merchant id
     * @param invoiceId - invoice id to query
     */
    // Ensure invoice belongs to merchant
    const inv = await this.pool.query('SELECT id FROM invoices WHERE id=$1 AND merchant_id=$2', [invoiceId, merchantId]);
    if (!inv.rows[0]) throw new NotFoundException('Invoice not found');

    const result = await this.pool.query(
      `SELECT event_type, COUNT(*)::int AS count
         FROM payment_link_events
        WHERE invoice_id=$1
        GROUP BY event_type`,
      [invoiceId],
    );

    const counts: Record<string, number> = { view: 0, attempt: 0, conversion: 0 };
    for (const row of result.rows) counts[row.event_type] = row.count;

    return {
      invoice_id: invoiceId,
      views: counts['view'],
      attempts: counts['attempt'],
      conversions: counts['conversion'],
      conversion_rate: counts['view'] > 0 ? (counts['conversion'] / counts['view']).toFixed(4) : '0.0000',
    };
  }

  async listAnalytics(merchantId: string, query: { page?: string; limit?: string }) {
    /**
     * List analytics for payment links belonging to a merchant.
     * @param merchantId - owning merchant id
     * @param query - pagination query
     */
    const page = Math.max(Number(query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    const offset = (page - 1) * limit;

    const result = await this.pool.query(
      `SELECT
          i.id AS invoice_id,
          i.description,
          i.status,
          i.created_at,
          COALESCE(SUM(CASE WHEN e.event_type='view' THEN 1 ELSE 0 END), 0)::int AS views,
          COALESCE(SUM(CASE WHEN e.event_type='attempt' THEN 1 ELSE 0 END), 0)::int AS attempts,
          COALESCE(SUM(CASE WHEN e.event_type='conversion' THEN 1 ELSE 0 END), 0)::int AS conversions,
          COUNT(i.id) OVER() AS total
         FROM invoices i
         LEFT JOIN payment_link_events e ON e.invoice_id=i.id
        WHERE i.merchant_id=$1
        GROUP BY i.id
        ORDER BY i.created_at DESC
        LIMIT $2 OFFSET $3`,
      [merchantId, limit, offset],
    );

    return {
      page,
      limit,
      total: Number(result.rows[0]?.total ?? 0),
      items: result.rows.map(({ total: _total, ...row }) => row),
    };
  }
}
