import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GraphqlGatewayController } from './graphql.gateway.controller';
import { GraphqlGatewayService } from './graphql.gateway.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { MerchantsModule } from '../merchants/merchants.module';

@Module({
  imports: [AuthModule, InvoicesModule, MerchantsModule],
  controllers: [GraphqlGatewayController],
  providers: [GraphqlGatewayService],
})
export class GraphqlGatewayModule {}
