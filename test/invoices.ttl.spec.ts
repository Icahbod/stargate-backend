import { InvoicesService } from '../src/invoices/invoices.service';

describe('InvoicesService.autoCancelUnpaidInvoices TTL behaviour', () => {
  it('queries unpaid_invoice_ttl_minutes and dispatches cancellation events', async () => {
    const rows = [ { id: 'inv-ttl-1', merchant_id: 'mer-ttl-1' } ];
    const pool = { query: jest.fn().mockResolvedValue({ rows }) } as any;
    const merchants: any = null;
    const stellar: any = null;
    const config: any = { get: () => 'https://pay.stargate.finance' };
    const webhooks = { dispatchEvent: jest.fn().mockResolvedValue(undefined) } as any;
    const idempotency: any = null;

    const service = new InvoicesService(pool, merchants, stellar, config, webhooks, idempotency);

    await service.autoCancelUnpaidInvoices();

    // Ensure the SQL references the unpaid_invoice_ttl_minutes column
    expect(pool.query).toHaveBeenCalled();
    const calledSql = (pool.query as jest.Mock).mock.calls[0][0] as string;
    expect(calledSql).toEqual(expect.stringContaining('unpaid_invoice_ttl_minutes'));

    expect(webhooks.dispatchEvent).toHaveBeenCalledWith(
      'mer-ttl-1',
      'merchant.payment_intent.expired',
      expect.objectContaining({ invoice_id: 'inv-ttl-1', reason: 'unpaid_invoice_ttl' }),
    );
  });
});
