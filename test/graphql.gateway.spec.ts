import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { GraphqlGatewayController } from '../src/graphql/graphql.gateway.controller';
import { GraphqlGatewayService } from '../src/graphql/graphql.gateway.service';
import { ConfigService } from '@nestjs/config';

const fakeMerchant = { id: 'merchant-1', name: 'Acme', email: 'acme@example.com', accepted_assets: ['USDC'], test_mode: true };
const fakeInvoice = { id: 'invoice-1', merchant_id: 'merchant-1', amount_usdc: '100.00', gross_usdc: '102.00', fee_usdc: '2.00', net_usdc: '98.00', currency: 'USDC', status: 'pending', description: 'Test invoice', expires_at: '2026-05-30T12:00:00.000Z', payment_url: 'https://pay.example.com/invoice-1', partial_payments_enabled: false, payment_events: [] };
const fakePublicInvoice = { id: 'invoice-1', gross_usdc: '102.00', gross_usdc_equiv: '102.00', currency: 'USDC', description: 'Test invoice', status: 'pending', muxed_address: 'MUXEDADDRESS', expires_at: '2026-05-30T12:00:00.000Z', merchant_name: 'Acme', test_mode: true };
const fakeRefund = { id: 'refund-1', invoice_id: 'invoice-1', amount_usdc: '100.00', status: 'submitted', soroban_tx_hash: 'txhash' };

describe('GraphQL Gateway', () => {
  let graphqlGatewayService: GraphqlGatewayService;
  let graphqlGatewayController: GraphqlGatewayController;

  const mockInvoicesService = {
    get: jest.fn().mockResolvedValue(fakeInvoice),
    list: jest.fn().mockResolvedValue({ limit: 20, items: [fakeInvoice], nextCursor: null }),
    getPublic: jest.fn().mockResolvedValue(fakePublicInvoice),
    create: jest.fn().mockResolvedValue(fakeInvoice),
    refund: jest.fn().mockResolvedValue(fakeRefund),
  };
  const mockMerchantsService = {
    findOne: jest.fn().mockResolvedValue(fakeMerchant),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GraphqlGatewayController],
      providers: [
        GraphqlGatewayService,
        {
          provide: ConfigService,
          useValue: { get: () => true },
        },
        {
          provide: 'InvoicesService',
          useValue: mockInvoicesService,
        },
        {
          provide: 'MerchantsService',
          useValue: mockMerchantsService,
        },
      ],
    })
      .overrideProvider(GraphqlGatewayService)
      .useFactory({
        factory: () => new GraphqlGatewayService(mockInvoicesService as any, mockMerchantsService as any),
      })
      .compile();

    graphqlGatewayService = moduleRef.get(GraphqlGatewayService);
    graphqlGatewayController = moduleRef.get(GraphqlGatewayController);
  });

  it('returns merchant data when querying merchantMe', async () => {
    const result = await graphqlGatewayService.execute('{ merchantMe { id name email } }', undefined, { user: { merchantId: 'merchant-1' } });
    expect(result.data).toEqual({ merchantMe: { id: 'merchant-1', name: 'Acme', email: 'acme@example.com' } });
  });

  it('returns invoice list from invoices query', async () => {
    const result = await graphqlGatewayService.execute('{ invoices { limit items { id } nextCursor } }', undefined, { user: { merchantId: 'merchant-1' } });
    expect(result.data).toEqual({ invoices: { limit: 20, items: [{ id: 'invoice-1' }], nextCursor: null } });
  });

  it('returns public invoice via publicInvoice query', async () => {
    const result = await graphqlGatewayService.execute('query($id: ID!) { publicInvoice(id: $id) { id merchant_name } }', { id: 'invoice-1' }, { user: { merchantId: 'merchant-1' } });
    expect(result.data).toEqual({ publicInvoice: { id: 'invoice-1', merchant_name: 'Acme' } });
  });

  it('returns GraphQL execution result via controller when enabled', async () => {
    const response = await graphqlGatewayController.execute(
      { user: { merchantId: 'merchant-1' } },
      { query: '{ merchantMe { id } }' },
    );
    expect(response.data).toEqual({ merchantMe: { id: 'merchant-1' } });
  });

  it('throws NotFoundException when GraphQL gateway is disabled', async () => {
    const disabledController = new GraphqlGatewayController({ get: () => false } as ConfigService, graphqlGatewayService);
    await expect(disabledController.execute({ user: { merchantId: 'merchant-1' } } as any, { query: '{ merchantMe { id } }' })).rejects.toThrow(NotFoundException);
  });
});
