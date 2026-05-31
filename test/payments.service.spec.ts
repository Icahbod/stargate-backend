import { PaymentsService } from '../src/payments/payments.service';

describe('PaymentsService – test mode routing', () => {
  it('routes invoice preparation to testnet when merchant is in test_mode', async () => {
    const invoice = {
      test_mode: true,
      muxed_address: 'MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      gross_usdc: '10.0000000',
      currency: 'USDC',
      description: 'Test invoice',
      status: 'pending',
      expires_at: '2026-01-01T00:00:00.000Z',
      merchant_name: 'Test Merchant',
    };
    const invoices = { getPublic: jest.fn().mockResolvedValue(invoice) };
    const stellar = { buildPaymentXdr: jest.fn().mockResolvedValue('XDR') };
    const service = new PaymentsService(undefined as any, invoices as any, stellar as any);

    const result = await service.prepareTx('invoice-1', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

    expect(stellar.buildPaymentXdr).toHaveBeenCalledWith(invoice, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', true);
    expect(result).toEqual({ xdr: 'XDR', network: 'testnet' });
  });

  it('routes invoice preparation to configured mainnet when merchant is not in test_mode', async () => {
    const originalNetwork = process.env.STELLAR_NETWORK;
    process.env.STELLAR_NETWORK = 'mainnet';
    const invoice = {
      test_mode: false,
      muxed_address: 'MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      gross_usdc: '10.0000000',
      currency: 'USDC',
      description: 'Test invoice',
      status: 'pending',
      expires_at: '2026-01-01T00:00:00.000Z',
      merchant_name: 'Test Merchant',
    };
    const invoices = { getPublic: jest.fn().mockResolvedValue(invoice) };
    const stellar = { buildPaymentXdr: jest.fn().mockResolvedValue('XDR') };
    const service = new PaymentsService(undefined as any, invoices as any, stellar as any);

    const result = await service.prepareTx('invoice-2', 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

    expect(stellar.buildPaymentXdr).toHaveBeenCalledWith(invoice, 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF', false);
    expect(result).toEqual({ xdr: 'XDR', network: 'mainnet' });
    process.env.STELLAR_NETWORK = originalNetwork;
  });
});
