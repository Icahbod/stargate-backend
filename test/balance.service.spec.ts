import { BalanceService } from '../src/balance/balance.service';
import { ConfigService } from '@nestjs/config';

const mockPool = { query: jest.fn() };
const mockConfigService = { get: jest.fn(), getOrThrow: jest.fn() } as any;

describe('BalanceService', () => {
  let service: BalanceService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService.getOrThrow.mockReturnValue('https://horizon-testnet.stellar.org');
    mockConfigService.get.mockReturnValue('USDC');
    service = new BalanceService(mockPool as any, mockConfigService);
  });

  it('should throw error when merchant not found', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    await expect(service.getMerchantBalance('unknown-merchant')).rejects.toThrow('Merchant not found');
  });

  it('should return zero balances when merchant has no stellar address', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stellar_address: null }] }) // merchant query
      .mockResolvedValueOnce({ rows: [{ pending_balance: '0' }] }); // pending balance query

    const result = await service.getMerchantBalance('merchant-1');

    expect(result).toEqual({
      merchant_id: 'merchant-1',
      on_chain_balance_usdc: '0',
      pending_settlement_balance_usdc: '0',
      total_balance_usdc: '0.0000000',
    });
  });

  it('should return pending settlement balance from ledger entries', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stellar_address: 'GTEST' }] }) // merchant query
      .mockResolvedValueOnce({ rows: [{ pending_balance: '150.5' }] }); // pending balance query

    const result = await service.getMerchantBalance('merchant-1');

    expect(result.pending_settlement_balance_usdc).toBe('150.5');
    expect(result.on_chain_balance_usdc).toBe('0');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('settlement_id IS NULL'),
      ['merchant-1'],
    );
  });

  it('should handle null pending balance from database', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stellar_address: 'GTEST' }] }) // merchant query
      .mockResolvedValueOnce({ rows: [{ pending_balance: null }] }); // pending balance query

    const result = await service.getMerchantBalance('merchant-1');

    expect(result.pending_settlement_balance_usdc).toBe('0');
  });

  it('should calculate total balance as sum of on-chain and pending', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stellar_address: 'GTEST' }] }) // merchant query
      .mockResolvedValueOnce({ rows: [{ pending_balance: '100' }] }); // pending balance query

    // Mock Horizon to return on-chain balance
    const mockHorizon = {
      loadAccount: jest.fn().mockResolvedValue({
        balances: [
          {
            balance: '50',
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: 'ISSUER',
          },
        ],
      }),
    };
    service['horizonServer'] = mockHorizon as any;
    mockConfigService.getOrThrow.mockReturnValue('ISSUER');

    const result = await service.getMerchantBalance('merchant-1');

    expect(result.on_chain_balance_usdc).toBe('50');
    expect(result.pending_settlement_balance_usdc).toBe('100');
    expect(result.total_balance_usdc).toBe('150.0000000');
  });

  it('should handle Horizon account not found gracefully', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stellar_address: 'GTEST' }] }) // merchant query
      .mockResolvedValueOnce({ rows: [{ pending_balance: '100' }] }); // pending balance query

    // Mock Horizon to throw an error (account doesn't exist)
    const mockHorizon = {
      loadAccount: jest.fn().mockRejectedValue(new Error('Not found')),
    };
    service['horizonServer'] = mockHorizon as any;

    const result = await service.getMerchantBalance('merchant-1');

    expect(result.on_chain_balance_usdc).toBe('0');
    expect(result.pending_settlement_balance_usdc).toBe('100');
    expect(result.total_balance_usdc).toBe('100.0000000');
  });

  it('should find correct asset balance from multiple balances', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ stellar_address: 'GTEST' }] }) // merchant query
      .mockResolvedValueOnce({ rows: [{ pending_balance: '0' }] }); // pending balance query

    // Mock Horizon with multiple assets
    const mockHorizon = {
      loadAccount: jest.fn().mockResolvedValue({
        balances: [
          {
            balance: '100',
            asset_type: 'credit_alphanum4',
            asset_code: 'OTHER',
            asset_issuer: 'ISSUER1',
          },
          {
            balance: '250.5',
            asset_type: 'credit_alphanum4',
            asset_code: 'USDC',
            asset_issuer: 'ISSUER2',
          },
        ],
      }),
    };
    service['horizonServer'] = mockHorizon as any;
    mockConfigService.getOrThrow.mockReturnValue('ISSUER2');

    const result = await service.getMerchantBalance('merchant-1');

    expect(result.on_chain_balance_usdc).toBe('250.5');
  });
});
