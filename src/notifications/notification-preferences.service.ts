import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { z } from 'zod';
import { DATABASE_POOL } from '../database/database.module';

const notificationEventTypes = [
  'invoice.paid',
  'invoice.expired',
  'invoice.cancelled',
  'settlement.completed',
  'merchant.kyc.approved',
  'merchant.kyc.rejected',
] as const;

type NotificationEventType = (typeof notificationEventTypes)[number];

const notificationPreferenceSchema = z.object({
  event_type: z.enum(notificationEventTypes),
  email_enabled: z.boolean().default(true),
  webhook_enabled: z.boolean().default(true),
});

type NotificationPreferenceDto = z.infer<typeof notificationPreferenceSchema>;

@Injectable()
export class NotificationPreferencesService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async list(merchantId: string) {
    const result = await this.pool.query(
      'SELECT event_type, email_enabled, webhook_enabled FROM notification_preferences WHERE merchant_id=$1',
      [merchantId],
    );
    const stored = new Map(result.rows.map((row) => [row.event_type, row]));
    return notificationEventTypes.map((event_type) =>
      stored.get(event_type) ?? { event_type, email_enabled: true, webhook_enabled: true },
    );
  }

  async get(merchantId: string, eventType: NotificationEventType) {
    const result = await this.pool.query(
      'SELECT event_type, email_enabled, webhook_enabled FROM notification_preferences WHERE merchant_id=$1 AND event_type=$2',
      [merchantId, eventType],
    );
    if (!result.rows[0]) {
      return { event_type: eventType, email_enabled: true, webhook_enabled: true };
    }
    return result.rows[0];
  }

  async upsert(merchantId: string, input: unknown) {
    const dto = notificationPreferenceSchema.parse(input);
    const result = await this.pool.query(
      `INSERT INTO notification_preferences (merchant_id, event_type, email_enabled, webhook_enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (merchant_id, event_type)
       DO UPDATE SET email_enabled = EXCLUDED.email_enabled, webhook_enabled = EXCLUDED.webhook_enabled, updated_at = NOW()
       RETURNING event_type, email_enabled, webhook_enabled`,
      [merchantId, dto.event_type, dto.email_enabled, dto.webhook_enabled],
    );
    return result.rows[0];
  }

  async remove(merchantId: string, eventType: NotificationEventType) {
    const result = await this.pool.query(
      'DELETE FROM notification_preferences WHERE merchant_id=$1 AND event_type=$2 RETURNING event_type',
      [merchantId, eventType],
    );
    if (!result.rows[0]) throw new NotFoundException('Notification preference not found');
    return { event_type: eventType };
  }
}
