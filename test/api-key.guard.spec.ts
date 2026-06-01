import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard, REQUIRED_SCOPE_KEY } from '../src/api-keys/api-key.guard';

const mockApiKeysService = { validate: jest.fn() };
const mockReflector = { get: jest.fn() };

function makeContext(
  authHeader: string,
  handler = () => {},
  extra?: { xForwardedFor?: string; reqIp?: string; socketRemoteAddress?: string },
) {
  const headers: Record<string, string> = {};
  if (authHeader) headers['authorization'] = authHeader;
  if (extra?.xForwardedFor) headers['x-forwarded-for'] = extra.xForwardedFor;

  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers,
        ip: extra?.reqIp,
        socket: { remoteAddress: extra?.socketRemoteAddress },
        user: undefined as any,
      }),
    }),
    getHandler: () => handler,
  } as any;
}

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new ApiKeyGuard(mockApiKeysService as any, mockReflector as any);
  });

  // ── Basic auth header validation ──

  it('throws when no Authorization header', async () => {
    await expect(guard.canActivate(makeContext(''))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('throws when header is not a sk_ key', async () => {
    await expect(guard.canActivate(makeContext('Bearer eyJhbGc...'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ── Scope enforcement: read-only keys on mutating endpoints ──

  it('allows read_only key on endpoint requiring read_only (GET equivalent)', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'read_only' });
    mockReflector.get.mockReturnValue('read_only');
    const ctx = makeContext('Bearer sk_abc');
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects read_only key on endpoint requiring full_access (POST/PUT/DELETE equivalent)', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'read_only' });
    mockReflector.get.mockReturnValue('full_access');
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects read_only key on endpoint requiring webhooks scope', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'read_only' });
    mockReflector.get.mockReturnValue('webhooks');
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects read_only key with descriptive error message', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'read_only' });
    mockReflector.get.mockReturnValue('full_access');
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).rejects.toThrow(
      "API key scope 'read_only' insufficient; requires 'full_access'",
    );
  });

  // ── Scope enforcement: webhooks key ──

  it('allows webhooks key on endpoint requiring webhooks', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'webhooks' });
    mockReflector.get.mockReturnValue('webhooks');
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).resolves.toBe(true);
  });

  it('rejects webhooks key on endpoint requiring full_access', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'webhooks' });
    mockReflector.get.mockReturnValue('full_access');
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  // ── Scope enforcement: full_access key ──

  it('allows full_access key on endpoint requiring read_only', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'full_access' });
    mockReflector.get.mockReturnValue('read_only');
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).resolves.toBe(true);
  });

  it('allows full_access key on endpoint requiring webhooks', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'full_access' });
    mockReflector.get.mockReturnValue('webhooks');
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).resolves.toBe(true);
  });

  it('allows full_access key on endpoint requiring full_access', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'full_access' });
    mockReflector.get.mockReturnValue('full_access');
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).resolves.toBe(true);
  });

  // ── No scope requirement on handler (endpoint without @RequireScope) ──

  it('allows any scope when no @RequireScope is present', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'read_only' });
    mockReflector.get.mockReturnValue(undefined);
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).resolves.toBe(true);
  });

  // ── IP extraction from headers ──

  it('extracts client IP from X-Forwarded-For header', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'read_only' });
    mockReflector.get.mockReturnValue(undefined);
    const ctx = makeContext('Bearer sk_abc', undefined, { xForwardedFor: '203.0.113.5, 10.0.0.1' });
    await guard.canActivate(ctx);
    expect(mockApiKeysService.validate).toHaveBeenCalledWith('sk_abc', '203.0.113.5');
  });

  it('falls back to req.ip when X-Forwarded-For is absent', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'read_only' });
    mockReflector.get.mockReturnValue(undefined);
    const ctx = makeContext('Bearer sk_abc', undefined, { reqIp: '192.168.1.1' });
    await guard.canActivate(ctx);
    expect(mockApiKeysService.validate).toHaveBeenCalledWith('sk_abc', '192.168.1.1');
  });

  it('falls back to socket.remoteAddress when req.ip is absent', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'read_only' });
    mockReflector.get.mockReturnValue(undefined);
    const ctx = makeContext('Bearer sk_abc', undefined, { socketRemoteAddress: '10.0.0.5' });
    await guard.canActivate(ctx);
    expect(mockApiKeysService.validate).toHaveBeenCalledWith('sk_abc', '10.0.0.5');
  });

  it('passes undefined clientIp when no IP info is available', async () => {
    mockApiKeysService.validate.mockResolvedValue({ merchantId: 'mid', scope: 'read_only' });
    mockReflector.get.mockReturnValue(undefined);
    const ctx = makeContext('Bearer sk_abc');
    await guard.canActivate(ctx);
    expect(mockApiKeysService.validate).toHaveBeenCalledWith('sk_abc', undefined);
  });

  // ── Rejection from downstream service validation ──

  it('propagates ForbiddenException from ApiKeysService IP allowlist rejection', async () => {
    mockApiKeysService.validate.mockRejectedValue(
      new ForbiddenException('Client IP address is not permitted for this API key'),
    );
    mockReflector.get.mockReturnValue(undefined);
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('propagates UnauthorizedException from ApiKeysService for invalid/expired key', async () => {
    mockApiKeysService.validate.mockRejectedValue(new UnauthorizedException('Invalid or expired API key'));
    mockReflector.get.mockReturnValue(undefined);
    await expect(guard.canActivate(makeContext('Bearer sk_abc'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
