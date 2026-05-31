import { NotFoundException } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';

const merchantId = 'merchant-1';
const webhookId = 'webhook-uuid-1';
const deliveryId = '42';

function makeService(queryMock: jest.Mock) {
  const pool = { query: queryMock };
  const audit = { log: jest.fn() };
  return new WebhooksService(pool as any, audit as any);
}

describe('WebhooksService.deliveries', () => {
  it('returns delivery list for a valid webhook', async () => {
    const rows = [
      { id: 1, webhook_id: webhookId, event_type: 'invoice.paid', status: 'delivered', attempts: 1, created_at: new Date().toISOString() },
    ];
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: webhookId }] }) // ownership check
      .mockResolvedValueOnce({ rows });

    const svc = makeService(query);
    const result = await svc.deliveries(merchantId, webhookId);
    expect(result).toEqual(rows);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('throws NotFoundException when webhook does not belong to merchant', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    const svc = makeService(query);
    await expect(svc.deliveries(merchantId, webhookId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WebhooksService.deliveryById', () => {
  it('returns a single delivery with payload', async () => {
    const row = {
      id: Number(deliveryId),
      webhook_id: webhookId,
      event_type: 'invoice.paid',
      payload: { invoice_id: 'inv-1' },
      status: 'delivered',
      attempts: 1,
      response_status: 200,
      delivered_at: new Date().toISOString(),
      next_retry_at: null,
      created_at: new Date().toISOString(),
    };
    const query = jest.fn().mockResolvedValueOnce({ rows: [row] });
    const svc = makeService(query);
    const result = await svc.deliveryById(merchantId, webhookId, deliveryId);
    expect(result).toEqual(row);
    // Verify the query scopes by merchant, webhook, and delivery id
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('merchant_id');
    expect(params).toContain(merchantId);
    expect(params).toContain(webhookId);
    expect(params).toContain(deliveryId);
  });

  it('throws NotFoundException when delivery does not exist', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    const svc = makeService(query);
    await expect(svc.deliveryById(merchantId, webhookId, deliveryId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when delivery belongs to a different merchant', async () => {
    // Simulates the JOIN filtering out the row
    const query = jest.fn().mockResolvedValueOnce({ rows: [] });
    const svc = makeService(query);
    await expect(svc.deliveryById('other-merchant', webhookId, deliveryId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('WebhooksService.replay', () => {
  it('resets delivery to pending state with cleared attempt data', async () => {
    const replayedRow = {
      id: Number(deliveryId),
      webhook_id: webhookId,
      event_type: 'invoice.paid',
      payload: { invoice_id: 'inv-1' },
      status: 'pending',
      attempts: 0,
      response_status: null,
      delivered_at: null,
      next_retry_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: webhookId }] }) // webhook ownership check
      .mockResolvedValueOnce({ rows: [replayedRow] }); // replay update

    const svc = makeService(query);
    const result = await svc.replay(merchantId, webhookId, deliveryId);

    expect(result).toEqual(replayedRow);
    expect(query).toHaveBeenCalledTimes(2);

    // Verify webhook ownership check
    const [webhookCheckSql, webhookCheckParams] = query.mock.calls[0];
    expect(webhookCheckSql).toContain('webhooks');
    expect(webhookCheckParams).toContain(webhookId);
    expect(webhookCheckParams).toContain(merchantId);

    // Verify replay update
    const [replaySql, replayParams] = query.mock.calls[1];
    expect(replaySql).toContain("status='pending'");
    expect(replaySql).toContain('attempts=0');
    expect(replaySql).toContain('response_status=NULL');
    expect(replaySql).toContain('delivered_at=NULL');
    expect(replaySql).toContain('next_retry_at=NOW()');
    expect(replayParams).toContain(deliveryId);
    expect(replayParams).toContain(webhookId);
  });

  it('throws NotFoundException when webhook does not belong to merchant', async () => {
    const query = jest.fn().mockResolvedValueOnce({ rows: [] }); // webhook ownership check fails
    const svc = makeService(query);
    await expect(svc.replay(merchantId, webhookId, deliveryId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when delivery does not exist', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: webhookId }] }) // webhook ownership check passes
      .mockResolvedValueOnce({ rows: [] }); // replay update fails

    const svc = makeService(query);
    await expect(svc.replay(merchantId, webhookId, deliveryId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('logs audit entry when replaying', async () => {
    const replayedRow = {
      id: Number(deliveryId),
      webhook_id: webhookId,
      status: 'pending',
      attempts: 0,
    };
    const auditLog = jest.fn();
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: webhookId }] })
      .mockResolvedValueOnce({ rows: [replayedRow] });

    const pool = { query };
    const audit = { log: auditLog };
    const svc = new WebhooksService(pool as any, audit as any);

    await svc.replay(merchantId, webhookId, deliveryId, '192.168.1.1', 'user@example.com');

    expect(auditLog).toHaveBeenCalledWith(
      merchantId,
      'webhook_replayed',
      'webhook',
      webhookId,
      expect.objectContaining({
        actorIp: '192.168.1.1',
        actorEmail: 'user@example.com',
        metadata: { deliveryId },
      }),
    );
  });
});
