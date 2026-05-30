import { Injectable } from '@nestjs/common';
import { buildSchema, graphql, GraphQLSchema } from 'graphql';
import { InvoicesService } from '../invoices/invoices.service';
import { MerchantsService } from '../merchants/merchants.service';

@Injectable()
export class GraphqlGatewayService {
  private readonly schema: GraphQLSchema;

  constructor(
    private readonly invoices: InvoicesService,
    private readonly merchants: MerchantsService,
  ) {
    this.schema = buildSchema(`
      type Query {
        merchantMe: Merchant
        invoice(id: ID!): Invoice
        invoices(status: String, limit: Int, cursor: String): InvoiceCollection
        publicInvoice(id: ID!): PublicInvoice
      }

      type Mutation {
        createInvoice(input: CreateInvoiceInput!, idempotencyKey: String): Invoice
        refundInvoice(id: ID!): Refund
      }

      input CreateInvoiceInput {
        amount: String!
        currency: String
        description: String
        expiresInMinutes: Int
        partialPaymentsEnabled: Boolean
      }

      type Merchant {
        id: ID!
        name: String
        email: String
        accepted_assets: [String]
        test_mode: Boolean
      }

      type InvoiceCollection {
        limit: Int!
        items: [Invoice!]!
        nextCursor: String
      }

      type Invoice {
        id: ID!
        merchant_id: ID
        amount_usdc: String
        gross_usdc: String
        fee_usdc: String
        net_usdc: String
        currency: String
        status: String
        description: String
        expires_at: String
        payment_url: String
        partial_payments_enabled: Boolean
        payment_events: [PaymentEvent!]
      }

      type PaymentEvent {
        id: ID!
        type: String
        status: String
        amount: String
        created_at: String
      }

      type PublicInvoice {
        id: ID!
        gross_usdc: String
        gross_usdc_equiv: String
        currency: String
        description: String
        status: String
        muxed_address: String
        expires_at: String
        merchant_name: String
        test_mode: Boolean
      }

      type Refund {
        id: ID!
        invoice_id: ID
        amount_usdc: String
        status: String
        soroban_tx_hash: String
      }
    `);
  }

  async execute(query: string, variables: Record<string, unknown> | undefined, context: { user: any }) {
    return graphql({
      schema: this.schema,
      source: query,
      variableValues: variables,
      rootValue: this.rootResolver(context),
      contextValue: context,
    });
  }

  private rootResolver(context: { user: any }) {
    return {
      merchantMe: async () => {
        return this.merchants.findOne(context.user.merchantId);
      },
      invoice: async ({ id }: { id: string }) => {
        return this.invoices.get(context.user.merchantId, id);
      },
      invoices: async ({ status, limit, cursor }: { status?: string; limit?: number; cursor?: string }) => {
        return this.invoices.list(context.user.merchantId, { status, limit, cursor });
      },
      publicInvoice: async ({ id }: { id: string }) => {
        return this.invoices.getPublic(id);
      },
      createInvoice: async ({ input, idempotencyKey }: { input: Record<string, unknown>; idempotencyKey?: string }) => {
        return this.invoices.create(context.user.merchantId, this.normalizeInvoiceInput(input), idempotencyKey);
      },
      refundInvoice: async ({ id }: { id: string }) => {
        return this.invoices.refund(context.user.merchantId, id);
      },
    };
  }

  private normalizeInvoiceInput(input: Record<string, unknown>) {
    return {
      ...input,
      expires_in_minutes: input.expiresInMinutes,
      partial_payments_enabled: input.partialPaymentsEnabled,
    };
  }
}
