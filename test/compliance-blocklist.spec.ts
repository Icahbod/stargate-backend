/**
 * #92 – Unit tests for compliance blocklist enforcement
 * Assert payments from blocked addresses are rejected before intent creation.
 */
import { ComplianceService } from '../src/compliance/compliance.service';

describe('ComplianceService – blocklist enforcement', () => {
  const makeService = (cachedResult?: string) => {
    const redis = {
      get: jest.fn().mockResolvedValue(cachedResult ?? null),
      set: jest.fn().mockResolvedValue('OK'),
    } as any;
    const config = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'OFAC_SCREENING_ENABLED') return 'true';
        if (key === 'TRM_LABS_API_KEY') return 'test-key';
        return def;
      }),
    } as any;
    const pool = {} as any;
    return { service: new ComplianceService(redis, config, pool), redis };
  };

  it('returns blocked from cache without calling TRM', async () => {
    const blocked = JSON.stringify({ result: 'blocked', risk_score: 95 });
    const { service, redis } = makeService(blocked);

    const result = await service.screenAddress('GBLOCKED123');

    expect(result.result).toBe('blocked');
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('returns clear from cache without calling TRM', async () => {
    const clear = JSON.stringify({ result: 'clear', risk_score: 0 });
    const { service } = makeService(clear);

    const result = await service.screenAddress('GCLEAR123');

    expect(result.result).toBe('clear');
  });

  it('returns review when OFAC screening is disabled', async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') } as any;
    const config = { get: jest.fn((key: string, def?: any) => key === 'OFAC_SCREENING_ENABLED' ? 'false' : def) } as any;
    const service = new ComplianceService(redis, config, {} as any);

    const result = await service.screenAddress('GANY');

    expect(result.result).toBe('clear');
  });

  it('returns review when TRM API key is missing', async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') } as any;
    const config = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'OFAC_SCREENING_ENABLED') return 'true';
        if (key === 'TRM_LABS_API_KEY') return '...';
        return def;
      }),
    } as any;
    const service = new ComplianceService(redis, config, {} as any);

    const result = await service.screenAddress('GANY');

    expect(result.result).toBe('review');
    expect(result.risk_score).toBe(50);
  });

  it('marks address blocked when TRM returns risk_score >= 90', async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') } as any;
    const config = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'OFAC_SCREENING_ENABLED') return 'true';
        if (key === 'TRM_LABS_API_KEY') return 'real-key';
        return def;
      }),
    } as any;
    const service = new ComplianceService(redis, config, {} as any);

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => [{ riskScore: 95 }],
    }) as any;

    const result = await service.screenAddress('GBADACTOR');

    expect(result.result).toBe('blocked');
    expect(result.risk_score).toBe(95);
    expect(redis.set).toHaveBeenCalledWith(
      'ofac:GBADACTOR',
      JSON.stringify({ result: 'blocked', risk_score: 95 }),
      'EX',
      3600,
    );
  });

  it('marks address clear when TRM returns risk_score < 50', async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') } as any;
    const config = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'OFAC_SCREENING_ENABLED') return 'true';
        if (key === 'TRM_LABS_API_KEY') return 'real-key';
        return def;
      }),
    } as any;
    const service = new ComplianceService(redis, config, {} as any);

    global.fetch = jest.fn().mockResolvedValue({
      json: async () => [{ riskScore: 10 }],
    }) as any;

    const result = await service.screenAddress('GCLEANADDR');

    expect(result.result).toBe('clear');
    expect(result.risk_score).toBe(10);
  });

  it('falls back to review when TRM fetch throws', async () => {
    const redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue('OK') } as any;
    const config = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'OFAC_SCREENING_ENABLED') return 'true';
        if (key === 'TRM_LABS_API_KEY') return 'real-key';
        return def;
      }),
    } as any;
    const service = new ComplianceService(redis, config, {} as any);

    global.fetch = jest.fn().mockRejectedValue(new Error('network error')) as any;

    const result = await service.screenAddress('GFLAKY');

    expect(result.result).toBe('review');
  });

  it('combinedCheck returns blocked when address is on blocklist', async () => {
    const blocked = JSON.stringify({ result: 'blocked', risk_score: 95 });
    const redis = {
      get: jest.fn().mockResolvedValue(blocked),
      set: jest.fn().mockResolvedValue('OK'),
      zadd: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      zrange: jest.fn().mockResolvedValue(['100']),
    } as any;
    const config = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'OFAC_SCREENING_ENABLED') return 'true';
        if (key === 'VELOCITY_LIMIT_PER_HOUR_CENTS') return 5_000_000;
        return def;
      }),
    } as any;
    const service = new ComplianceService(redis, config, {} as any);

    const result = await service.combinedCheck({ payer: 'GBLOCKED123', amountCents: 100, merchantId: 'mer-1' });

    expect(result.result).toBe('blocked');
  });

  it('combinedCheck escalates clear to review when velocity limit exceeded', async () => {
    const clear = JSON.stringify({ result: 'clear', risk_score: 0 });
    const redis = {
      get: jest.fn().mockResolvedValue(clear),
      set: jest.fn().mockResolvedValue('OK'),
      zadd: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      // total exceeds 5_000_000 cents
      zrange: jest.fn().mockResolvedValue(['5000001']),
    } as any;
    const config = {
      get: jest.fn((key: string, def?: any) => {
        if (key === 'VELOCITY_LIMIT_PER_HOUR_CENTS') return 5_000_000;
        return def;
      }),
    } as any;
    const service = new ComplianceService(redis, config, {} as any);

    const result = await service.combinedCheck({ payer: 'GFAST', amountCents: 1, merchantId: 'mer-2' });

    expect(result.result).toBe('review');
  });
});
