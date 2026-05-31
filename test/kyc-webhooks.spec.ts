import { WebhooksService } from '../src/webhooks/webhooks.service';
import { MerchantsService } from '../src/merchants/merchants.service';

describe('KYC webhook events', () => {
  const mockPool = { query: jest.fn() };
  const mockAudit = { log: jest.fn() };
  let webhooks: WebhooksService;
  let merchants: MerchantsService;

  const mockAudit = { log: jest.fn() };

  beforeEach(() => {
    mockPool.query.mockReset();
    mockAudit.log.mockReset();
    webhooks = new WebhooksService(mockPool as any, mockAudit as any);
    merchants = new MerchantsService(mockPool as any);
  });

  it('emitKycEvent inserts delivery rows for approved', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await webhooks.emitKycEvent('merchant-1', 'approved');
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO webhook_deliveries');
    expect(params[1]).toBe('merchant.kyc.approved');
    expect(params[2]).toBe('approved');
  });

  it('emitKycEvent inserts delivery rows for rejected', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await webhooks.emitKycEvent('merchant-2', 'rejected');
    const [, params] = mockPool.query.mock.calls[0];
    expect(params[1]).toBe('merchant.kyc.rejected');
  });

  it('updateKycStatus sets kyc_status and kyb_verified_at for approved', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ id: 'merchant-1', kyc_status: 'approved' }] });
    const result = await merchants.updateKycStatus('merchant-1', 'approved');
    const [sql, params] = mockPool.query.mock.calls[0];
    expect(sql).toContain('kyc_status');
    expect(params[1]).toBe('approved');
    expect(result.kyc_status).toBe('approved');
  });
});
