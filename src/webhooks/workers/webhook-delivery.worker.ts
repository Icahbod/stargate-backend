import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { DATABASE_POOL } from '../../database/database.module';
import { WebhooksService } from '../webhooks.service';
import { AppLogger } from '../../logger/logger.service';
import { correlationStorage } from '../../logger/correlation.context';
import { CORRELATION_ID_HEADER } from '../../logger/correlation.middleware';

// Base backoff delays in minutes: attempt 1→1m, 2→5m, 3→30m, 4→120m
const BACKOFF_MINUTES = [0, 1, 5, 30, 120];

@Injectable()
export class WebhookDeliveryWorker {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: Pool,
    private readonly webhooks: WebhooksService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  @Cron('*/30 * * * * *')
  async deliverPending() {
    const result = await this.pool.query(
      `SELECT d.*, w.url, w.hashed_secret, w.previous_hashed_secret, w.secret_rotated_at
         FROM webhook_deliveries d
         JOIN webhooks w ON w.id=d.webhook_id
        WHERE w.active=true
          AND d.status='pending'
          AND (d.next_retry_at IS NULL OR d.next_retry_at <= NOW())
        ORDER BY d.created_at
        LIMIT 50`,
    );

    for (const delivery of result.rows) {
      const correlationId = randomUUID();
      await correlationStorage.run({ correlationId }, () => this.deliver(delivery, correlationId));
    }
  }

  private async deliver(delivery: any, correlationId: string) {
    const attempts = Number(delivery.attempts) + 1;
    const signatures = [this.webhooks.sign(delivery.hashed_secret, delivery.payload)];
    if (delivery.previous_hashed_secret && delivery.secret_rotated_at) {
      const graceMs = 24 * 60 * 60 * 1000;
      if (Date.now() - new Date(delivery.secret_rotated_at).getTime() < graceMs) {
        signatures.push(this.webhooks.sign(delivery.previous_hashed_secret, delivery.payload));
    // Compute the raw body exactly as sent and compute HMACs over those bytes.
    const rawBody = JSON.stringify(delivery.payload);
    const signatures = [this.webhooks.sign(delivery.secret, rawBody)];
    if (delivery.previous_secret && delivery.secret_rotated_at) {
      const rotatedAt = new Date(delivery.secret_rotated_at).getTime();
      const graceMs = 24 * 60 * 60 * 1000;
      if (Date.now() - rotatedAt < graceMs) {
        signatures.push(this.webhooks.sign(delivery.previous_secret, rawBody));
      }
    }

    this.logger.log(
      { event: 'webhook.deliver.attempt', deliveryId: delivery.id, url: delivery.url, attempt: attempts },
      'WebhookDeliveryWorker',
    );

    try {
      const response = await fetch(delivery.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-stargate-signature': signatures[0],
          ...(signatures[1] ? { 'x-stargate-signature-prev': signatures[1] } : {}),
          'x-stargate-event': delivery.event_type,
          [CORRELATION_ID_HEADER]: correlationId,
        },
        body: rawBody,
        signal: AbortSignal.timeout(this.config.get<number>('WEBHOOK_TIMEOUT_MS', 5000)),
      });
      const succeeded = response.ok;
      const dead = !succeeded && attempts >= 5;

      this.logger.log(
        { event: 'webhook.deliver.response', deliveryId: delivery.id, status: response.status, ok: response.ok },
        'WebhookDeliveryWorker',
      );

      await this.pool.query(
        `UPDATE webhook_deliveries SET status=$2, attempts=$3, response_status=$4, delivered_at=CASE WHEN $2='delivered' THEN NOW() ELSE NULL END, next_retry_at=$5 WHERE id=$1`,
        [delivery.id, succeeded ? 'delivered' : dead ? 'dead' : 'pending', attempts, response.status, succeeded || dead ? null : this.nextRetry(attempts)],
      );
    } catch {
      const dead = attempts >= 5;
    } catch (err) {
      this.logger.error(
        { event: 'webhook.deliver.error', deliveryId: delivery.id, url: delivery.url, attempt: attempts },
        err instanceof Error ? err.message : String(err),
        'WebhookDeliveryWorker',
      );
      await this.pool.query(
        `UPDATE webhook_deliveries SET status=$2, attempts=$3, next_retry_at=$4 WHERE id=$1`,
        [delivery.id, dead ? 'dead' : 'pending', attempts, dead ? null : this.nextRetry(attempts)],
      );
    }
  }

  /** Exponential backoff with configurable jitter.
   *  WEBHOOK_JITTER_MAX_MS (default 30 000) controls the max random offset added. */
  nextRetry(attempts: number): Date {
    const baseMs = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)] * 60_000;
    const jitterMax = this.config.get<number>('WEBHOOK_JITTER_MAX_MS', 30_000);
    const jitter = Math.floor(Math.random() * jitterMax);
    return new Date(Date.now() + baseMs + jitter);
  }
}
