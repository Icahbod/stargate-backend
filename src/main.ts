import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { AppLogger } from './logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get(AppLogger);
  app.useLogger(logger);
  app.use(cookieParser());
  app.enableCors({ origin: true, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const config = new DocumentBuilder()
    .setTitle('Stargate API')
    .setVersion('1.0')
    .setDescription('Multi-tenant USDC payments on Stellar')
    .addBearerAuth()
    .addTag('auth', 'Merchant registration, login, token refresh, and logout')
    .addTag('merchants', 'Merchant profile management')
    .addTag('compliance', 'OFAC screening and KYC document upload')
    .addTag('invoices', 'Invoice lifecycle: create, list, retrieve, and cancel')
    .addTag('payments', 'Stellar payment transaction preparation and real-time status streaming')
    .addTag('webhooks', 'Webhook endpoint registration, delivery history, and retry')
    .addTag('health', 'Service health and dependency checks')
    .addTag('api-keys', 'Programmatic API key management')
    .addTag('estimates', 'FX rate and fee estimation')
    .addTag('settlement', 'Settlement stream and payout management')
    .build();

  const document = SwaggerModule.createDocument(app, config);

  // x-readme extensions for ReadMe.io portal
  (document as any)['x-readme'] = {
    'samples-languages': ['curl', 'node', 'python', 'ruby'],
    'explorer-enabled': true,
    'proxy-enabled': false,
  };

  SwaggerModule.setup('docs', app, document);

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}

bootstrap();
