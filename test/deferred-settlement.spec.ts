import { SettlementService } from '../src/settlement/settlement.service';

function makeService(merchantRows: any[]) {
  const pool = {
    query: jest.fn().mockImplementation((sql: string) => {
      if (sql.includes('SUM(net_usdc)')) return Promise.resolve({ rows: merchantRows, rowCount: merchantRows.length });
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
  };
  const kms = { signDigest: jest.fn() };
  return new (SettlementService as any)(pool, kms);
}

describe('SettlementService – deferred settlement', () => {
  it('creates settlements for due merchants', async () => {
    const svc = makeService([{ merchant_id: 'm1', amount: '50.0000000' }]);
    const count = await svc.createDailySettlements();
    expect(count).toBe(1);
  });

  it('returns 0 when no merchants are due', async () => {
    const svc = makeService([]);
    const count = await svc.createDailySettlements();
    expect(count).toBe(0);
  });

  it('clears settlement_scheduled_at after triggering', async () => {
    const queries: string[] = [];
    const pool = {
      query: jest.fn().mockImplementation((sql: string) => {
        queries.push(sql);
        if (sql.includes('SUM(net_usdc)')) return Promise.resolve({ rows: [{ merchant_id: 'm1', amount: '10' }], rowCount: 1 });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };
    const svc = new (SettlementService as any)(pool, { signDigest: jest.fn() });
    await svc.createDailySettlements();
    expect(queries.some((q) => q.includes('settlement_scheduled_at=NULL'))).toBe(true);
  });

  it('rolls back settlement creation when a settlement leg fails', async () => {
    const client = {
      query: jest.fn().mockImplementation((sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT') return Promise.resolve({ rows: [] });
        if (sql === 'ROLLBACK') return Promise.resolve({ rows: [] });
        if (sql.includes('SELECT id FROM settlements')) return Promise.resolve({ rows: [] });
        if (sql.includes('INSERT INTO settlements')) return Promise.reject(new Error('create settlement failed'));
        return Promise.resolve({ rows: [] });
      }),
      release: jest.fn(),
    };
    const pool = {
      query: jest.fn().mockResolvedValue({ rows: [{ merchant_id: 'm1', amount: '10.0000000' }], rowCount: 1 }),
      connect: jest.fn().mockResolvedValue(client),
    };
    const svc = new (SettlementService as any)(pool as any, { signDigest: jest.fn() });

    await expect(svc.createDailySettlements()).rejects.toThrow('create settlement failed');
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
  });
});
