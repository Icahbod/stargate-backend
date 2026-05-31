import { NotFoundException } from '@nestjs/common';
import { NotificationPreferencesService } from './notification-preferences.service';

describe('NotificationPreferencesService', () => {
  const merchantId = 'merchant-1';
  const eventType = 'invoice.paid';

  function makeService(queryMock: jest.Mock) {
    return new NotificationPreferencesService({ query: queryMock } as any);
  }

  it('returns default preferences for missing event type', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    const service = makeService(query);
    const result = await service.get(merchantId, eventType as any);
    expect(result).toEqual({ event_type: eventType, email_enabled: true, webhook_enabled: true });
    expect(query).toHaveBeenCalledWith(
      'SELECT event_type, email_enabled, webhook_enabled FROM notification_preferences WHERE merchant_id=$1 AND event_type=$2',
      [merchantId, eventType],
    );
  });

  it('lists all event types with defaults when none are stored', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    const service = makeService(query);
    const result = await service.list(merchantId);
    expect(result).toHaveLength(6);
    expect(result[0]).toMatchObject({ event_type: 'invoice.paid', email_enabled: true, webhook_enabled: true });
  });

  it('upserts a notification preference row', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ event_type: eventType, email_enabled: false, webhook_enabled: true }] });
    const service = makeService(query);
    const result = await service.upsert(merchantId, { event_type: eventType, email_enabled: false, webhook_enabled: true });
    expect(result).toEqual({ event_type: eventType, email_enabled: false, webhook_enabled: true });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO notification_preferences'),
      [merchantId, eventType, false, true],
    );
  });

  it('removes stored notification preferences', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [{ event_type: eventType }] });
    const service = makeService(query);
    const result = await service.remove(merchantId, eventType as any);
    expect(result).toEqual({ event_type: eventType });
  });

  it('throws NotFoundException when deleting missing preference', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    const service = makeService(query);
    await expect(service.remove(merchantId, eventType as any)).rejects.toBeInstanceOf(NotFoundException);
  });
});
