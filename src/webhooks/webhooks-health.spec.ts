import { WebhooksService } from './webhooks.service';

describe('WebhooksService.health', () => {
  const mockAudit = { log: jest.fn() };

  it('returns success_rate, latency_p99_ms, last_failure_at', async () => {
    const row = { delivered: '9', total: '10', latency_p99_ms: '320.5', last_failure_at: '2024-01-01T00:00:00Z' };
    const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) } as any;
    const service = new WebhooksService(pool, mockAudit as any);

    const result = await service.health('mer-1', 'hook-1');

    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('PERCENTILE_CONT'), ['hook-1', 'mer-1']);
    expect(result.success_rate).toBeCloseTo(0.9);
    expect(result.latency_p99_ms).toBeCloseTo(320.5);
    expect(result.last_failure_at).toBe('2024-01-01T00:00:00Z');
  });

  it('returns null success_rate when no deliveries', async () => {
    const row = { delivered: '0', total: '0', latency_p99_ms: null, last_failure_at: null };
    const pool = { query: jest.fn().mockResolvedValue({ rows: [row] }) } as any;
    const service = new WebhooksService(pool, mockAudit as any);

    const result = await service.health('mer-1', 'hook-1');
    expect(result.success_rate).toBeNull();
    expect(result.latency_p99_ms).toBeNull();
    expect(result.last_failure_at).toBeNull();
  });
});
