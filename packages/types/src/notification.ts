export type NotificationEventType =
  | 'invoice.paid'
  | 'invoice.expired'
  | 'invoice.cancelled'
  | 'settlement.completed'
  | 'merchant.kyc.approved'
  | 'merchant.kyc.rejected';

export interface NotificationPreference {
  event_type: NotificationEventType;
  email_enabled: boolean;
  webhook_enabled: boolean;
}
