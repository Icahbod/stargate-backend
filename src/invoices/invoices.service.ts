import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { Pool } from 'pg';
import { z } from 'zod';
import { DATABASE_POOL } from '../database/database.module';
import { FxRateService, SupportedCurrency } from '../fx/fx-rate.service';
import { IdempotencyService } from '../idempotency/idempotency.service';
import { MerchantsService } from '../merchants/merchants.service';
import { StellarService } from '../stellar/stellar.service';
import { WebhooksService } from '../webhooks/webhooks.service';

const SUPPORTED_CURRENCIES = ['USDC', 'EURC', 'XLM'] as const;

const createInvoiceSchema = z.object({
  amount: z
    .union([z.number().positive().max(100_000), z.string().regex(/^\d+(\.\d{1,7})?$/)])
    .transform((v) => String(v))
    .optional(),
  // Legacy field — kept for backward compat
  amount_usdc: z
    .union([z.number().positive().max(100_000), z.string().regex(/^\d+(\.\d{1,7})?$/)])
    .transform((v) => String(v))
    .optional(),
  currency: z.enum(SUPPORTED_CURRENCIES).default('USDC'),
  description: z.string().max(500).optional(),
  expires_in_minutes: z.number().int().min(5).max(10080).default(60),
  partial_payments_enabled: z.boolean().default(false),
}).transform((d) => ({
  ...d,
  amount: d.amount ?? d.amount_usdc,
})).refine((d) => !!d.amount, { message: 'amount is required' });

const SCALE = 10_000_000n;

function toUnits(amount: string) {
  const [whole, fraction = ''] = amount.split('.');
  const units = BigInt(whole) * SCALE + BigInt((fraction + '0000000').slice(0, 7));
  if (units <= 0n) throw new BadRequestException('Amount must be greater than zero');
  return units;
}

function fromUnits(units: bigint) {
  const whole = units / SCALE;
  const fraction = (units % SCALE).toString().padStart(7, '0');
  return `${whole}.${fraction}`;
}

@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly merchants: MerchantsService,
    private readonly stellar: StellarService,
    private readonly config: ConfigService,
    private readonly webhooks: WebhooksService,
    private readonly idempotency: IdempotencyService,
    private readonly fx?: FxRateService,
  ) {}

  async create(merchantId: string, input: unknown, idempotencyKey?: string) {
    const bodyHash = this.idempotency.hashBody(input);

    if (idempotencyKey) {
      const cached = await this.idempotency.check(merchantId, idempotencyKey, bodyHash);
      if (cached) return cached;

      const existing = await this.pool.query(
        `SELECT *, $3::text || '/pay/' || id AS payment_url FROM invoices WHERE merchant_id=$1 AND idempotency_key=$2`,
        [merchantId, idempotencyKey, this.config.get<string>('PUBLIC_PAY_URL', 'https://pay.stargate.finance')],
      );
      if (existing.rows[0]) return existing.rows[0];
    }

    const dto = createInvoiceSchema.parse(input);
    const currency = dto.currency as SupportedCurrency;
    const merchant = await this.merchants.findOne(merchantId);

    // Validate merchant accepts this currency
    if (merchant.accepted_assets && !merchant.accepted_assets.includes(currency)) {
      throw new BadRequestException(`Merchant does not accept ${currency}`);
    }

    // Convert amount to USDC for fee/limit calculations
    const usdcEquivStr = await this.fx!.toUsdc(dto.amount!, currency);
    const usdcEquiv = toUnits(usdcEquivStr);

    await this.enforceSpendLimits(merchantId, merchant, usdcEquiv);

    if (merchant.min_invoice_usdc) {
      if (usdcEquiv < toUnits(merchant.min_invoice_usdc))
        throw new BadRequestException(`Invoice amount must be at least ${merchant.min_invoice_usdc} USDC equivalent`);
    }
    if (merchant.max_invoice_usdc) {
      if (usdcEquiv > toUnits(merchant.max_invoice_usdc))
        throw new BadRequestException(`Invoice amount cannot exceed ${merchant.max_invoice_usdc} USDC equivalent`);
    }

    const amount = toUnits(dto.amount!);
    const fee = this.calculateFee(usdcEquiv, merchant);
    // Fee is always in USDC; gross in native currency = amount + fee converted back
    const feeInCurrency = currency === 'USDC'
      ? fee
      : toUnits(await this.fx!.toUsdc(fromUnits(fee), 'USDC').then(async (usdcFee) => {
          const rate = await this.fx!.getRate(currency);
          return (parseFloat(usdcFee) / rate).toFixed(7);
        }));
    const gross = amount + feeInCurrency;
    const net = amount - this.fixedFeeUnits(merchant);

    const muxedBaseId = await this.ensureMuxedBase(merchantId);
    const next = await this.nextInvoiceSequence(merchantId);
    const muxedId = muxedBaseId + next;
    const muxedAddress = this.stellar.buildMuxedAddress(muxedId);
    const expiresAt = new Date(Date.now() + dto.expires_in_minutes * 60_000);

    // gross_usdc_equiv stores the USDC value for reconciliation
    const grossUsdcEquiv = currency === 'USDC' ? fromUnits(gross) : usdcEquivStr;

    const result = await this.pool.query(
      `INSERT INTO invoices
         (merchant_id, amount_usdc, gross_usdc, fee_usdc, net_usdc, description,
          muxed_id, muxed_address, expires_at, amount_remaining_usdc, partial_payments_enabled,
          idempotency_key, currency, gross_usdc_equiv)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *, $15::text || '/pay/' || id AS payment_url`,
      [
        merchantId,
        fromUnits(amount),
        fromUnits(gross),
        fromUnits(fee),
        fromUnits(net > 0n ? net : 0n),
        dto.description ?? null,
        muxedId.toString(),
        muxedAddress,
        expiresAt,
        fromUnits(gross),
        dto.partial_payments_enabled,
        idempotencyKey ?? null,
        currency,
        grossUsdcEquiv,
        this.config.get<string>('PUBLIC_PAY_URL', 'https://pay.stargate.finance'),
      ],
    );
    const invoice = result.rows[0];

    if (idempotencyKey) {
      await this.idempotency.save(merchantId, idempotencyKey, bodyHash, invoice);
    }

    return invoice;
  }

  async createBulk(merchantId: string, inputs: unknown[]) {
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 100)
      throw new BadRequestException('Provide between 1 and 100 invoices');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const results: any[] = [];
      for (const input of inputs) {
        results.push(await this.create(merchantId, input));
      }
      await client.query('COMMIT');
      return results;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async list(merchantId: string, query: any) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    const status = query.status;
    const cursor = query.cursor;

    let params: any[] = [merchantId, limit + 1];
    let cursorSql = '';

    if (cursor) {
      const [createdAt, id] = cursor.split(':');
      cursorSql = 'AND (created_at, id) < ($3::timestamptz, $4::uuid)';
      params.push(createdAt, id);
    }

    const statusSql = status ? `AND status=$${params.length + 1}` : '';
    if (status) params.push(status);

    const result = await this.pool.query(
      `SELECT * FROM invoices
        WHERE merchant_id=$1 ${cursorSql} ${statusSql}
        ORDER BY created_at DESC, id DESC
        LIMIT $2`,
      params,
    );

    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = hasMore
      ? `${items[items.length - 1].created_at.toISOString()}:${items[items.length - 1].id}`
      : null;

    return { limit, items, nextCursor };
  }

  async get(merchantId: string, id: string) {
    const invoice = await this.pool.query('SELECT * FROM invoices WHERE id=$1 AND merchant_id=$2', [id, merchantId]);
    if (!invoice.rows[0]) throw new NotFoundException('Invoice not found');
    const events = await this.pool.query('SELECT * FROM payment_events WHERE invoice_id=$1 ORDER BY created_at DESC', [id]);
    return { ...invoice.rows[0], payment_events: events.rows };
  }

  async getPublic(id: string) {
    const result = await this.pool.query(
      `SELECT i.id, i.gross_usdc, i.gross_usdc_equiv, i.currency, i.description,
              i.status, i.muxed_address, i.expires_at,
              m.name AS merchant_name, m.test_mode
         FROM invoices i
         JOIN merchants m ON m.id=i.merchant_id
        WHERE i.id=$1`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundException('Invoice not found');
    return result.rows[0];
  }

  async refund(merchantId: string, id: string) {
    const invoice = await this.get(merchantId, id);
    if (invoice.status !== 'paid') throw new BadRequestException('Only paid invoices can be refunded');
    const existing = await this.pool.query(
      `SELECT id FROM refunds WHERE invoice_id=$1 AND status NOT IN ('failed')`,
      [id],
    );
    if (existing.rows[0]) throw new BadRequestException('Refund already initiated for this invoice');
    const merchant = await this.merchants.findOne(merchantId);
    if (!merchant.stellar_address) throw new BadRequestException('Merchant has no stellar_address set');
    const txHash = await this.stellar.submitSorobanRefund(invoice, merchant.stellar_address);
    const result = await this.pool.query(
      `INSERT INTO refunds (invoice_id, merchant_id, amount_usdc, status, soroban_tx_hash)
       VALUES ($1,$2,$3,'submitted',$4) RETURNING *`,
      [id, merchantId, invoice.amount_usdc, txHash],
    );
    return result.rows[0];
  }

  async generatePdf(merchantId: string, id: string) {
    const { payment_events: _events, ...invoice } = await this.get(merchantId, id);
    const merchant = await this.merchants.findOne(merchantId);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.fontSize(20).text('Invoice Receipt', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12);
    doc.text(`Merchant: ${merchant.name}`);
    doc.text(`Invoice ID: ${invoice.id}`);
    doc.text(`Status: ${invoice.status}`);
    doc.text(`Currency: ${invoice.currency ?? 'USDC'}`);
    doc.text(`Amount: ${invoice.amount_usdc} ${invoice.currency ?? 'USDC'}`);
    doc.text(`Fee (USDC): ${invoice.fee_usdc}`);
    doc.text(`Net (USDC): ${invoice.net_usdc}`);
    if (invoice.description) doc.text(`Description: ${invoice.description}`);
    doc.text(`Created: ${new Date(invoice.created_at).toISOString()}`);
    if (invoice.paid_at) doc.text(`Paid: ${new Date(invoice.paid_at).toISOString()}`);
    doc.end();
    return doc;
  }

  async cancel(merchantId: string, id: string) {
    const result = await this.pool.query(
      `UPDATE invoices SET status='cancelled'
        WHERE id=$1 AND merchant_id=$2 AND status IN ('pending','partial')
        RETURNING *`,
      [id, merchantId],
    );
    if (!result.rows[0]) throw new NotFoundException('Pending invoice not found');
    return result.rows[0];
  }

  async applyPartialPayment(invoiceId: string, paidAmount: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT * FROM invoices WHERE id=$1 AND status IN ('pending','partial') FOR UPDATE`,
        [invoiceId],
      );
      if (!rows[0]) throw new NotFoundException('Active invoice not found');
      const invoice = rows[0];
      if (!invoice.partial_payments_enabled) throw new BadRequestException('Partial payments not enabled for this invoice');
      const paid = toUnits(paidAmount);
      const remaining = toUnits(String(invoice.amount_remaining_usdc)) - paid;
      if (remaining < 0n) throw new BadRequestException('Payment exceeds remaining balance');
      const newStatus = remaining === 0n ? 'paid' : 'partial';
      const updated = await client.query(
        `UPDATE invoices
            SET amount_paid_usdc = amount_paid_usdc + $2,
                amount_remaining_usdc = $3,
                status = $4,
                paid_at = CASE WHEN $4='paid' THEN NOW() ELSE NULL END
          WHERE id=$1
          RETURNING *`,
        [invoiceId, paidAmount, fromUnits(remaining), newStatus],
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  @Cron('0 */5 * * * *')
  async expireInvoices() {
    // Expire invoices whose expires_at timestamp has passed
    const result = await this.pool.query(
      `UPDATE invoices SET status='expired'
       WHERE status IN ('pending','partial') AND expires_at < NOW()
       RETURNING id, merchant_id`,
    );

    for (const row of result.rows) {
      await this.webhooks.dispatchEvent(row.merchant_id, 'merchant.payment_intent.expired', {
        invoice_id: row.id,
        expired_at: new Date().toISOString(),
        reason: 'expires_at',
      });
    }
  }

  @Cron('30 */5 * * * *')
  async autoCancelUnpaidInvoices() {
    // Merchant-configured TTL (unpaid_invoice_ttl_minutes) for unpaid invoices.
    // If the TTL elapses, cancel invoices that are still not paid.
    const result = await this.pool.query(
      `UPDATE invoices i
         SET status='cancelled'
       FROM merchants m
      WHERE i.merchant_id = m.id
        AND i.status IN ('pending','partial')
        AND m.unpaid_invoice_ttl_minutes IS NOT NULL
        AND (i.created_at + (m.unpaid_invoice_ttl_minutes || ' minutes')::interval) < NOW()
      RETURNING i.id, i.merchant_id`,
    );

    for (const row of result.rows) {
      // Reuse existing event model currently used for expiry notifications.
      // Webhook consumers can treat this as a payment-intent expiry.
      await this.webhooks.dispatchEvent(row.merchant_id, 'merchant.payment_intent.expired', {
        invoice_id: row.id,
        expired_at: new Date().toISOString(),
        reason: 'unpaid_invoice_ttl',
      });

      // Also emit the explicit cancellation event when supported.
      await this.webhooks.dispatchEvent(row.merchant_id, 'invoice.cancelled', {
        invoice_id: row.id,
        cancelled_at: new Date().toISOString(),
        reason: 'unpaid_invoice_ttl',
      });
    }
  }

  private async enforceSpendLimits(merchantId: string, merchant: any, usdcAmount: bigint) {
    if (merchant.daily_spend_limit_usdc) {
      const { rows } = await this.pool.query(
        `SELECT COALESCE(SUM(gross_usdc_equiv::numeric),0) AS total FROM invoices
          WHERE merchant_id=$1 AND created_at >= date_trunc('day', NOW()) AND status != 'cancelled'`,
        [merchantId],
      );
      if (toUnits(String(rows[0].total)) + usdcAmount > toUnits(String(merchant.daily_spend_limit_usdc)))
        throw new BadRequestException('Daily spend limit exceeded');
    }
    if (merchant.monthly_spend_limit_usdc) {
      const { rows } = await this.pool.query(
        `SELECT COALESCE(SUM(gross_usdc_equiv::numeric),0) AS total FROM invoices
          WHERE merchant_id=$1 AND created_at >= date_trunc('month', NOW()) AND status != 'cancelled'`,
        [merchantId],
      );
      if (toUnits(String(rows[0].total)) + usdcAmount > toUnits(String(merchant.monthly_spend_limit_usdc)))
        throw new BadRequestException('Monthly spend limit exceeded');
    }
  }

  private calculateFee(usdcAmount: bigint, merchant: any) {
    const bps = merchant.tier === 'pro' ? 30n : merchant.tier === 'enterprise' ? BigInt(merchant.fee_bps) : 50n;
    return (usdcAmount * bps) / 10_000n + this.fixedFeeUnits(merchant);
  }

  private fixedFeeUnits(merchant: any) {
    if (merchant.tier === 'pro') return toUnits('0.10');
    if (merchant.tier === 'enterprise') return toUnits(String(merchant.fee_fixed_usdc));
    return toUnits('0.25');
  }

  private async ensureMuxedBase(merchantId: string) {
    const current = await this.pool.query('SELECT muxed_base_id FROM merchants WHERE id=$1', [merchantId]);
    if (current.rows[0]?.muxed_base_id) return BigInt(current.rows[0].muxed_base_id);
    const index = await this.pool.query(
      `SELECT COUNT(*)::bigint AS index FROM merchants WHERE created_at <= (SELECT created_at FROM merchants WHERE id=$1)`,
      [merchantId],
    );
    const base = BigInt(index.rows[0].index) * 16_777_216n;
    await this.pool.query('UPDATE merchants SET muxed_base_id=$2 WHERE id=$1', [merchantId, base.toString()]);
    return base;
  }

  private async nextInvoiceSequence(merchantId: string) {
    const result = await this.pool.query('SELECT COUNT(*)::bigint + 1 AS next FROM invoices WHERE merchant_id=$1', [merchantId]);
    return BigInt(result.rows[0].next);
  }
}
