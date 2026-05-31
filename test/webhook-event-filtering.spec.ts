import { WebhooksService, WEBHOOK_EVENT_TYPES } from '../src/webhooks/webhooks.service';

describe('WebhooksService – event type filtering', () => {
  const mockPool = { query: jest.fn() };
  const mockAudit = { log: jest.fn() };
  let webhooksService: WebhooksService;

  beforeEach(() => {
    mockPool.query.mockReset();
    mockAudit.log.mockReset();
    webhooksService = new WebhooksService(mockPool as any, mockAudit as any);
  });

  describe('dispatchEvent – filters by event type', () => {
    it('only delivers to webhooks subscribed to the event type', async () => {
      const merchantId = 'merchant-1';
      const eventType = 'invoice.paid';
      const payload = { invoice_id: 'inv-1', amount: '100.00' };

      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'webhook-1' }, { id: 'webhook-2' }] });
      mockPool.query.mockResolvedValueOnce({});

      await webhooksService.dispatchEvent(merchantId, eventType, payload);

      // First query should filter by event type
      const [filterQuery, filterParams] = mockPool.query.mock.calls[0];
      expect(filterQuery).toContain('$2=ANY(events)');
      expect(filterParams).toEqual([merchantId, eventType]);

      // Should insert deliveries for matching webhooks
      expect(mockPool.query.mock.calls[1][0]).toContain('INSERT INTO webhook_deliveries');
    });

    it('does not deliver to webhooks with different subscribed events', async () => {
      const merchantId = 'merchant-1';
      const eventType = 'invoice.paid';

      // Simulate: webhook subscribed to settlement.completed, not invoice.paid
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await webhooksService.dispatchEvent(merchantId, eventType, {});

      const [, filterParams] = mockPool.query.mock.calls[0];
      expect(filterParams[1]).toBe(eventType);
      // No deliveries should be inserted if no webhooks match
      expect(mockPool.query.mock.calls.length).toBe(1);
    });

    it('delivers to multiple webhooks subscribed to same event', async () => {
      const merchantId = 'merchant-1';
      const eventType = 'invoice.expired';

      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'webhook-a' }, { id: 'webhook-b' }, { id: 'webhook-c' }],
      });
      mockPool.query.mockResolvedValueOnce({});

      await webhooksService.dispatchEvent(merchantId, eventType, {});

      // Should query for matching webhooks
      expect(mockPool.query.mock.calls[0][1][1]).toBe('invoice.expired');
      expect(mockPool.query.mock.calls.length).toBe(2);
    });

    it('filters settlement.completed events to subscribers only', async () => {
      const merchantId = 'merchant-1';
      const eventType = 'settlement.completed';

      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'settlement-webhook' }] });
      mockPool.query.mockResolvedValueOnce({});

      await webhooksService.dispatchEvent(merchantId, eventType, {
        settlement_id: 'settle-1',
        amount: '500.00',
      });

      const [, params] = mockPool.query.mock.calls[0];
      expect(params[1]).toBe('settlement.completed');
    });

    it('filters merchant.kyc.approved events', async () => {
      const merchantId = 'merchant-1';

      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'kyc-webhook-1' }] });
      mockPool.query.mockResolvedValueOnce({});

      await webhooksService.emitKycEvent(merchantId, 'approved');

      const [query, params] = mockPool.query.mock.calls[0];
      expect(query).toContain('merchant.kyc.approved');
      expect(query).toContain('$2=ANY(events)');
      expect(params[1]).toBe('merchant.kyc.approved');
    });

    it('filters merchant.kyc.rejected events', async () => {
      const merchantId = 'merchant-1';

      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'kyc-webhook-1' }] });

      await webhooksService.emitKycEvent(merchantId, 'rejected');

      const [query, params] = mockPool.query.mock.calls[0];
      expect(query).toContain('merchant.kyc.rejected');
      expect(params[1]).toBe('merchant.kyc.rejected');
    });

    it('only delivers to active webhooks', async () => {
      const merchantId = 'merchant-1';

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await webhooksService.dispatchEvent(merchantId, 'invoice.paid', {});

      const [query] = mockPool.query.mock.calls[0];
      expect(query).toContain('active=true');
    });
  });

  describe('webhook subscription filtering', () => {
    it('creates webhook with specific event types', async () => {
      const merchantId = 'merchant-1';

      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'webhook-1',
            url: 'https://example.com/webhook',
            events: ['invoice.paid', 'settlement.completed'],
            active: true,
            created_at: '2026-05-31T00:00:00Z',
            secret: 'whsec_test',
          },
        ],
      });

      const result = await webhooksService.create(merchantId, {
        url: 'https://example.com/webhook',
        events: ['invoice.paid', 'settlement.completed'],
      });

      expect(result.events).toEqual(['invoice.paid', 'settlement.completed']);
    });

    it('respects webhook-specific event subscriptions', async () => {
      const merchantId = 'merchant-1';

      // Webhook A subscribed to: invoice.paid, invoice.expired
      // Webhook B subscribed to: settlement.completed

      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: 'webhook-a' }], // Should match
      });

      await webhooksService.dispatchEvent(merchantId, 'invoice.paid', {});

      expect(mockPool.query.mock.calls[0][1][1]).toBe('invoice.paid');
    });

    it('supports all defined event types', () => {
      const supportedEvents = WEBHOOK_EVENT_TYPES;
      expect(supportedEvents).toContain('invoice.paid');
      expect(supportedEvents).toContain('invoice.expired');
      expect(supportedEvents).toContain('invoice.cancelled');
      expect(supportedEvents).toContain('settlement.completed');
      expect(supportedEvents).toContain('merchant.kyc.approved');
      expect(supportedEvents).toContain('merchant.kyc.rejected');
    });
  });
});
