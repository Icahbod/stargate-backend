import { WebhookDeliveryWorker } from '../../src/webhooks/workers/webhook-delivery.worker';
import { WebhooksService } from '../../src/webhooks/webhooks.service';

describe('Webhook retry backoff and jitter (#90)', () => {
  let worker: WebhookDeliveryWorker;
  let mockPool: { query: jest.Mock };
  let mockConfig: { get: jest.Mock };
  let mockWebhooks: Partial<WebhooksService>;

  const baseDelivery = {
    id: 'del-1',
    webhook_id: 'hook-1',
    url: 'https://example.com/webhook',
    hashed_secret: 'secret',
    previous_hashed_secret: null,
    secret_rotated_at: null,
    event_type: 'invoice.paid',
    payload: { id: 'inv-1' },
    attempts: 0,
  };

  beforeEach(() => {
    mockPool = { query: jest.fn() };
    mockConfig = { get: jest.fn((key: string, def: number) => def) };
    mockWebhooks = { sign: jest.fn().mockReturnValue('sha256=abc') };
    worker = new WebhookDeliveryWorker(mockPool as any, mockWebhooks as any, mockConfig as any);
  });

  describe('nextRetry backoff schedule', () => {
    it('uses 0-minute base for attempt 1 (immediate retry)', () => {
      mockConfig.get.mockReturnValue(0); // no jitter
      const before = Date.now();
      const next = worker.nextRetry(1);
      expect(next.getTime()).toBeGreaterThanOrEqual(before);
      expect(next.getTime()).toBeLessThan(before + 2000);
    });

    it('uses 1-minute base for attempt 2', () => {
      mockConfig.get.mockReturnValue(0);
      const before = Date.now();
      const next = worker.nextRetry(2);
      expect(next.getTime()).toBeGreaterThanOrEqual(before + 60_000);
      expect(next.getTime()).toBeLessThan(before + 62_000);
    });

    it('uses 5-minute base for attempt 3', () => {
      mockConfig.get.mockReturnValue(0);
      const before = Date.now();
      const next = worker.nextRetry(3);
      expect(next.getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000);
      expect(next.getTime()).toBeLessThan(before + 5 * 60_000 + 2000);
    });

    it('uses 30-minute base for attempt 4', () => {
      mockConfig.get.mockReturnValue(0);
      const before = Date.now();
      const next = worker.nextRetry(4);
      expect(next.getTime()).toBeGreaterThanOrEqual(before + 30 * 60_000);
    });

    it('caps at 120-minute base for attempt 5+', () => {
      mockConfig.get.mockReturnValue(0);
      const before = Date.now();
      const next5 = worker.nextRetry(5);
      const next9 = worker.nextRetry(9);
      expect(next5.getTime()).toBeGreaterThanOrEqual(before + 120 * 60_000);
      expect(next9.getTime()).toBeGreaterThanOrEqual(before + 120 * 60_000);
    });
  });

  describe('jitter', () => {
    it('adds jitter within configured WEBHOOK_JITTER_MAX_MS', () => {
      const jitterMax = 10_000;
      mockConfig.get.mockImplementation((key: string, def: number) =>
        key === 'WEBHOOK_JITTER_MAX_MS' ? jitterMax : def,
      );
      const base = Date.now() + 60_000; // attempt 2 base
      const samples = Array.from({ length: 20 }, () => worker.nextRetry(2).getTime());
      const min = Math.min(...samples);
      const max = Math.max(...samples);
      expect(min).toBeGreaterThanOrEqual(base - 100); // allow 100ms clock drift
      expect(max).toBeLessThanOrEqual(base + jitterMax + 100);
      // With 20 samples and 10s window, expect some spread
      expect(max - min).toBeGreaterThan(0);
    });

    it('respects WEBHOOK_JITTER_MAX_MS=0 (no jitter)', () => {
      mockConfig.get.mockReturnValue(0);
      const before = Date.now();
      const t1 = worker.nextRetry(2).getTime();
      const t2 = worker.nextRetry(2).getTime();
      expect(t1).toBeGreaterThanOrEqual(before + 60_000);
      expect(t2).toBeGreaterThanOrEqual(before + 60_000);
      expect(Math.abs(t1 - t2)).toBeLessThan(100);
    });
  });

  describe('endpoint failure simulation', () => {
    it('marks delivery as pending with next_retry_at on non-2xx response', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ ...baseDelivery, attempts: 0 }] }) // SELECT
        .mockResolvedValueOnce({ rows: [] }); // UPDATE

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

      await worker.deliverPending();

      const updateCall = mockPool.query.mock.calls[1];
      expect(updateCall[0]).toContain('UPDATE webhook_deliveries');
      expect(updateCall[1][1]).toBe('pending'); // status stays pending
      expect(updateCall[1][2]).toBe(1); // attempts incremented
      expect(updateCall[1][3]).toBe(500); // response_status recorded
      expect(updateCall[1][4]).toBeInstanceOf(Date); // next_retry_at set
    });

    it('marks delivery as dead after 5 failed attempts', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ ...baseDelivery, attempts: 4 }] })
        .mockResolvedValueOnce({ rows: [] });

      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 });

      await worker.deliverPending();

      const updateCall = mockPool.query.mock.calls[1];
      expect(updateCall[1][1]).toBe('dead');
      expect(updateCall[1][4]).toBeNull(); // no next_retry_at
    });

    it('marks delivery as dead after 5 network errors', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ ...baseDelivery, attempts: 4 }] })
        .mockResolvedValueOnce({ rows: [] });

      global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      await worker.deliverPending();

      const updateCall = mockPool.query.mock.calls[1];
      expect(updateCall[1][1]).toBe('dead');
      expect(updateCall[1][3]).toBeNull(); // no next_retry_at
    });

    it('marks delivery as delivered on 2xx', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ ...baseDelivery, attempts: 1 }] })
        .mockResolvedValueOnce({ rows: [] });

      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      await worker.deliverPending();

      const updateCall = mockPool.query.mock.calls[1];
      expect(updateCall[1][1]).toBe('delivered');
      expect(updateCall[1][4]).toBeNull(); // no next_retry_at
    });

    it('processes multiple pending deliveries in one cron tick', async () => {
      const deliveries = [
        { ...baseDelivery, id: 'del-1', attempts: 0 },
        { ...baseDelivery, id: 'del-2', attempts: 0 },
      ];
      mockPool.query
        .mockResolvedValueOnce({ rows: deliveries })
        .mockResolvedValue({ rows: [] });

      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });

      await worker.deliverPending();

      // 1 SELECT + 2 UPDATEs
      expect(mockPool.query).toHaveBeenCalledTimes(3);
    });
  });
});
