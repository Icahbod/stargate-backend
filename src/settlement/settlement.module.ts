import { Module } from '@nestjs/common';
import { StellarModule } from '../stellar/stellar.module';
import { SettlementController } from './settlement.controller';
import { SettlementStreamService } from './settlement-stream.service';
import { SettlementService } from './settlement.service';
import { SettlementWorker } from './workers/settlement.worker';

@Module({
  imports: [StellarModule],
  controllers: [SettlementController],
  providers: [SettlementService, SettlementStreamService, SettlementWorker],
  exports: [SettlementService],
})
export class SettlementModule {}
