import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { HealthService } from '../src/health/health.service';

// ---------------------------------------------------------------------------
// Integration tests for HealthService.getRpcHealth() — #113
//
// A real HTTP server stands in for Stellar Horizon so we can control the
// status code it returns and assert that /health/rpc responds correctly.
// ---------------------------------------------------------------------------

describe('HealthService – Stellar Horizon RPC reachability (#113)', () => {
  let server: http.Server;
  let baseUrl: string;
  let respondWith: number;

  const mockPool = { query: jest.fn() };
  const mockRedis = {
    status: 'ready' as const,
    ping: jest.fn().mockResolvedValue('PONG'),
    connect: jest.fn(),
  };

  function makeConfig(overrides: Record<string, string | undefined> = {}): ConfigService {
    return {
      get: (key: string, def?: string) => (key in overrides ? overrides[key] : def),
    } as unknown as ConfigService;
  }

  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(respondWith);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  );

  // -------------------------------------------------------------------------
  // stellar_horizon checks
  // -------------------------------------------------------------------------

  it('reports stellar_horizon as up when Horizon returns 200', async () => {
    respondWith = 200;
    const svc = new HealthService(mockPool as any, mockRedis as any, makeConfig({ HORIZON_URL: baseUrl }));
    const result = await svc.getRpcHealth();

    expect(result.checks.stellar_horizon.status).toBe('up');
    expect(result.status).toBe('ok');
  });

  it('reports stellar_horizon as down when Horizon returns 503', async () => {
    respondWith = 503;
    const svc = new HealthService(mockPool as any, mockRedis as any, makeConfig({ HORIZON_URL: baseUrl }));
    const result = await svc.getRpcHealth();

    expect(result.checks.stellar_horizon.status).toBe('down');
    expect(result.status).toBe('degraded');
  });

  it('reports stellar_horizon as down when Horizon returns 500', async () => {
    respondWith = 500;
    const svc = new HealthService(mockPool as any, mockRedis as any, makeConfig({ HORIZON_URL: baseUrl }));
    const result = await svc.getRpcHealth();

    expect(result.checks.stellar_horizon.status).toBe('down');
    expect(result.status).toBe('degraded');
  });

  it('reports stellar_horizon as down when Horizon is unreachable (ECONNREFUSED)', async () => {
    // Grab a free port, bind a temp server to it, then close it — the port will
    // refuse new connections immediately, giving us a deterministic ECONNREFUSED.
    const tempServer = http.createServer();
    await new Promise<void>((resolve) => tempServer.listen(0, '127.0.0.1', resolve));
    const { port } = tempServer.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => tempServer.close((err) => (err ? reject(err) : resolve())));

    const svc = new HealthService(
      mockPool as any,
      mockRedis as any,
      makeConfig({ HORIZON_URL: `http://127.0.0.1:${port}` }),
    );
    const result = await svc.getRpcHealth();

    expect(result.checks.stellar_horizon.status).toBe('down');
    expect(result.status).toBe('degraded');
  });

  it('reports stellar_horizon as down when HORIZON_URL is not configured (required field)', async () => {
    const svc = new HealthService(mockPool as any, mockRedis as any, makeConfig());
    const result = await svc.getRpcHealth();

    expect(result.checks.stellar_horizon.status).toBe('down');
    expect(result.status).toBe('degraded');
  });

  // -------------------------------------------------------------------------
  // soroban_rpc checks
  // -------------------------------------------------------------------------

  it('reports soroban_rpc as not_configured when SOROBAN_RPC_URL is absent', async () => {
    respondWith = 200;
    const svc = new HealthService(
      mockPool as any,
      mockRedis as any,
      makeConfig({ HORIZON_URL: baseUrl }),
    );
    const result = await svc.getRpcHealth();

    // not_configured is treated as healthy — overall status should still be ok
    expect(result.checks.soroban_rpc.status).toBe('not_configured');
    expect(result.status).toBe('ok');
  });

  it('reports soroban_rpc as up when SOROBAN_RPC_URL returns 200', async () => {
    respondWith = 200;
    const svc = new HealthService(
      mockPool as any,
      mockRedis as any,
      makeConfig({ HORIZON_URL: baseUrl, SOROBAN_RPC_URL: baseUrl }),
    );
    const result = await svc.getRpcHealth();

    expect(result.checks.soroban_rpc.status).toBe('up');
    expect(result.checks.stellar_horizon.status).toBe('up');
    expect(result.status).toBe('ok');
  });

  it('reports soroban_rpc as down when SOROBAN_RPC_URL returns a non-2xx response', async () => {
    respondWith = 502;
    const svc = new HealthService(
      mockPool as any,
      mockRedis as any,
      makeConfig({ HORIZON_URL: baseUrl, SOROBAN_RPC_URL: baseUrl }),
    );
    const result = await svc.getRpcHealth();

    expect(result.checks.soroban_rpc.status).toBe('down');
    expect(result.status).toBe('degraded');
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  it('includes latencyMs >= 0 for each check', async () => {
    respondWith = 200;
    const svc = new HealthService(
      mockPool as any,
      mockRedis as any,
      makeConfig({ HORIZON_URL: baseUrl, SOROBAN_RPC_URL: baseUrl }),
    );
    const result = await svc.getRpcHealth();

    expect(result.checks.stellar_horizon.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.checks.soroban_rpc.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('includes the STELLAR_NETWORK value in the result', async () => {
    respondWith = 200;
    const svc = new HealthService(
      mockPool as any,
      mockRedis as any,
      makeConfig({ HORIZON_URL: baseUrl, STELLAR_NETWORK: 'mainnet' }),
    );
    const result = await svc.getRpcHealth();

    expect(result.network).toBe('mainnet');
  });

  it('defaults STELLAR_NETWORK to "testnet" when not configured', async () => {
    respondWith = 200;
    const svc = new HealthService(mockPool as any, mockRedis as any, makeConfig({ HORIZON_URL: baseUrl }));
    const result = await svc.getRpcHealth();

    expect(result.network).toBe('testnet');
  });

  it('includes a timestamp ISO string in the result', async () => {
    respondWith = 200;
    const svc = new HealthService(mockPool as any, mockRedis as any, makeConfig({ HORIZON_URL: baseUrl }));
    const result = await svc.getRpcHealth();

    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
