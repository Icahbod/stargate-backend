/**
 * #89 – Integration tests for /health/deep endpoint
 * Mock Postgres, Redis, RPC and assert correct degraded/healthy status.
 */
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from '../src/health/health.controller';
import { HealthService } from '../src/health/health.service';

const makeService = (opts: { dbOk?: boolean; redisOk?: boolean; horizonOk?: boolean; sorobanConfigured?: boolean } = {}) => {
  const { dbOk = true, redisOk = true, horizonOk = true, sorobanConfigured = false } = opts;

  const pool = {
    query: dbOk
      ? jest.fn().mockResolvedValue({ rows: [{}] })
      : jest.fn().mockRejectedValue(new Error('connection refused')),
  } as any;

  const redis = {
    status: 'ready',
    ping: redisOk
      ? jest.fn().mockResolvedValue('PONG')
      : jest.fn().mockRejectedValue(new Error('redis down')),
    connect: jest.fn().mockResolvedValue(undefined),
  } as any;

  const config = {
    get: jest.fn((key: string, def?: any) => {
      if (key === 'HORIZON_URL') return horizonOk ? 'https://horizon.stellar.org' : undefined;
      if (key === 'SOROBAN_RPC_URL') return sorobanConfigured ? 'https://soroban-rpc.stellar.org' : undefined;
      if (key === 'STELLAR_NETWORK') return 'testnet';
      return def;
    }),
  } as any;

  return new HealthService(pool, redis, config);
};

describe('HealthService.getDeepHealth', () => {
  it('returns ok when all dependencies are healthy', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const service = makeService();

    const result = await service.getDeepHealth();

    expect(result.status).toBe('ok');
    expect(result.checks.database.status).toBe('up');
    expect(result.checks.redis.status).toBe('up');
    expect(result.checks.stellar_horizon.status).toBe('up');
  });

  it('returns degraded when Postgres is down', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const service = makeService({ dbOk: false });

    const result = await service.getDeepHealth();

    expect(result.status).toBe('degraded');
    expect(result.checks.database.status).toBe('down');
  });

  it('returns degraded when Redis is down', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const service = makeService({ redisOk: false });

    const result = await service.getDeepHealth();

    expect(result.status).toBe('degraded');
    expect(result.checks.redis.status).toBe('down');
  });

  it('returns degraded when Horizon RPC is not configured', async () => {
    const service = makeService({ horizonOk: false });

    const result = await service.getDeepHealth();

    expect(result.status).toBe('degraded');
    expect(result.checks.stellar_horizon.status).toBe('down');
  });

  it('treats unconfigured optional soroban_rpc as not_configured (still ok)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const service = makeService({ sorobanConfigured: false });

    const result = await service.getDeepHealth();

    expect(result.checks.soroban_rpc.status).toBe('not_configured');
    expect(result.status).toBe('ok');
  });

  it('returns degraded when Horizon returns non-2xx', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as any;
    const service = makeService();

    const result = await service.getDeepHealth();

    expect(result.status).toBe('degraded');
    expect(result.checks.stellar_horizon.status).toBe('down');
  });

  it('includes latencyMs for every check', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const service = makeService();

    const result = await service.getDeepHealth();

    for (const check of Object.values(result.checks)) {
      expect(typeof (check as any).latencyMs).toBe('number');
    }
  });

  it('includes version and timestamp fields', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as any;
    const service = makeService();

    const result = await service.getDeepHealth();

    expect(result.version).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });
});

describe('HealthController.getDeepHealth', () => {
  it('returns 200 body when status is ok', async () => {
    const service = { getDeepHealth: jest.fn().mockResolvedValue({ status: 'ok', checks: {}, version: '1.0.0', timestamp: '' }) } as any;
    const controller = new HealthController(service);

    const result = await controller.getDeepHealth();

    expect(result.status).toBe('ok');
  });

  it('throws ServiceUnavailableException when status is degraded', async () => {
    const degraded = { status: 'degraded', checks: { database: { status: 'down', latencyMs: 0 } }, version: '1.0.0', timestamp: '' };
    const service = { getDeepHealth: jest.fn().mockResolvedValue(degraded) } as any;
    const controller = new HealthController(service);

    await expect(controller.getDeepHealth()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
