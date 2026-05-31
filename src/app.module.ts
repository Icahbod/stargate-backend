import { AdminModule } from './admin/admin.module';
import { BalanceModule } from './balance/balance.module';
import { TreasuryModule } from './treasury/treasury.module';
import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ApiKeysModule } from './api-keys/api-keys.module';
import { AuditModule } from './audit/audit.module';
import { AuditLogsModule } from './audit-logs/audit-logs.module';
import { AuthModule } from './auth/auth.module';
import { ComplianceModule } from './compliance/compliance.module';
import { validate } from './config/validate';
import { DatabaseModule } from './database/database.module';
import { DevModule } from './dev/dev.module';
import { EstimatesModule } from './estimates/estimates.module';
import { HealthModule } from './health/health.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { InvoicesModule } from './invoices/invoices.module';
import { CorrelationMiddleware } from './logger/correlation.middleware';
import { LoggerModule } from './logger/logger.module';
import { MerchantsModule } from './merchants/merchants.module';
import { PaymentLinksModule } from './payment-links/payment-links.module';
import { PaymentsModule } from './payments/payments.module';
import { RedisModule } from './redis/redis.module';
import { SchedulesModule } from './schedules/schedules.module';
import { SettlementModule } from './settlement/settlement.module';
import { SorobanEventsModule } from './soroban-events/soroban-events.module';
import { StellarModule } from './stellar/stellar.module';
import { TeamMembersModule } from './team-members/team-members.module';
import { TreasuryModule } from './treasury/treasury.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { NotificationPreferencesModule } from './notifications/notification-preferences.module';
import { DevModule } from './dev/dev.module';
import { AdminModule } from './admin/admin.module';
import { MetricsModule } from './metrics/metrics.module';
import { MetricsMiddleware } from './metrics/metrics.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ScheduleModule.forRoot(),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRY', '15m') },
      }),
    }),
    DatabaseModule,
    RedisModule,
    LoggerModule,
    HealthModule,
    AuthModule,
    AuditModule,
    MerchantsModule,
    StellarModule,
    ComplianceModule,
    IdempotencyModule,
    InvoicesModule,
    PaymentsModule,
    PaymentLinksModule,
    WebhooksModule,
    NotificationPreferencesModule,
    SettlementModule,
    BalanceModule,
    ApiKeysModule,
    AuditModule,
    SorobanEventsModule,
    EstimatesModule,
    SchedulesModule,
    AuditLogsModule,
    AdminModule,
    TreasuryModule,
    TeamMembersModule,
    DevModule,
    MetricsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(MetricsMiddleware)
      .exclude({ path: '/metrics', method: undefined as any })
      .forRoutes('*');


    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
