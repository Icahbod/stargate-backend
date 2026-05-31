import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApiKeysService } from '../src/api-keys/api-keys.service';

const mockPool = { query: jest.fn() };

describe('ApiKeysService', () => {
  let service: ApiKeysService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ApiKeysService(mockPool as any);
  });

  it('create returns the raw key once', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'uuid', name: 'test', key_prefix: 'sk_xxxxxxxx', scope: 'read_only', expires_at: null, allowed_ips: null, created_at: new Date() }],
    });
    const result = await service.create('merchant-1', { name: 'test', scope: 'read_only' });
    expect(result.key).toMatch(/^sk_/);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
  });

  it('create stores allowed_ips when provided', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'uuid', name: 'test', key_prefix: 'sk_xxxxxxxx', scope: 'read_only', expires_at: null, allowed_ips: ['10.0.0.0/8'], created_at: new Date() }],
    });
    await service.create('merchant-1', { name: 'test', scope: 'read_only', allowed_ips: ['10.0.0.0/8'] });
    expect(mockPool.query.mock.calls[0][1][6]).toEqual(['10.0.0.0/8']);
  });

  it('create passes null for allowed_ips when not provided', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ id: 'uuid', name: 'test', key_prefix: 'sk_xxxxxxxx', scope: 'read_only', expires_at: null, allowed_ips: null, created_at: new Date() }],
    });
    await service.create('merchant-1', { name: 'test', scope: 'read_only' });
    expect(mockPool.query.mock.calls[0][1][6]).toBeNull();
  });

  it('list queries only non-revoked keys', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await service.list('merchant-1');
    expect(mockPool.query.mock.calls[0][0]).toContain('revoked_at IS NULL');
  });

  it('revoke returns null when key not found', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    const result = await service.revoke('merchant-1', 'bad-id');
    expect(result).toBeNull();
  });

  it('validate throws on unknown key', async () => {
    mockPool.query.mockResolvedValue({ rows: [] });
    await expect(service.validate('sk_unknown')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('validate returns merchantId and scope on valid key with no IP restriction', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'full_access', allowed_ips: null }] });
    const result = await service.validate('sk_somekey');
    expect(result).toEqual({ merchantId: 'mid', scope: 'full_access' });
    const hash = createHash('sha256').update('sk_somekey').digest('hex');
    expect(mockPool.query.mock.calls[0][1][0]).toBe(hash);
  });

  describe('IP allowlist enforcement', () => {
    it('allows any IP when allowed_ips is null', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: null }] });
      await expect(service.validate('sk_key', '8.8.8.8')).resolves.toEqual({ merchantId: 'mid', scope: 'read_only' });
    });

    it('allows any IP when allowed_ips is an empty array', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: [] }] });
      await expect(service.validate('sk_key', '1.2.3.4')).resolves.toEqual({ merchantId: 'mid', scope: 'read_only' });
    });

    it('allows a matching exact IP', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: ['192.168.1.50'] }] });
      await expect(service.validate('sk_key', '192.168.1.50')).resolves.toEqual({ merchantId: 'mid', scope: 'read_only' });
    });

    it('rejects a non-matching exact IP', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: ['192.168.1.50'] }] });
      await expect(service.validate('sk_key', '192.168.1.51')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an IP within a /24 CIDR range', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'full_access', allowed_ips: ['10.0.1.0/24'] }] });
      await expect(service.validate('sk_key', '10.0.1.200')).resolves.toEqual({ merchantId: 'mid', scope: 'full_access' });
    });

    it('rejects an IP outside a /24 CIDR range', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'full_access', allowed_ips: ['10.0.1.0/24'] }] });
      await expect(service.validate('sk_key', '10.0.2.1')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an IP matching any entry in a multi-entry allowlist', async () => {
      mockPool.query.mockResolvedValue({
        rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: ['192.168.0.0/16', '10.10.10.10'] }],
      });
      await expect(service.validate('sk_key', '192.168.5.100')).resolves.toEqual({ merchantId: 'mid', scope: 'read_only' });
      mockPool.query.mockResolvedValue({
        rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: ['192.168.0.0/16', '10.10.10.10'] }],
      });
      await expect(service.validate('sk_key', '10.10.10.10')).resolves.toEqual({ merchantId: 'mid', scope: 'read_only' });
    });

    it('rejects when IP restrictions exist but clientIp is not provided', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: ['10.0.0.0/8'] }] });
      await expect(service.validate('sk_key')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows a /8 supernet', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: ['10.0.0.0/8'] }] });
      await expect(service.validate('sk_key', '10.255.255.1')).resolves.toEqual({ merchantId: 'mid', scope: 'read_only' });
    });

    it('matches IPv6 exact address', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: ['::1'] }] });
      await expect(service.validate('sk_key', '::1')).resolves.toEqual({ merchantId: 'mid', scope: 'read_only' });
    });

    it('rejects non-matching IPv6 address', async () => {
      mockPool.query.mockResolvedValue({ rows: [{ merchant_id: 'mid', scope: 'read_only', allowed_ips: ['::1'] }] });
      await expect(service.validate('sk_key', '::2')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
