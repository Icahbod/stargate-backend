import { Controller, Param, Req, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SettlementStreamService } from './settlement-stream.service';

@ApiTags('settlement')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('settlement')
export class SettlementController {
  constructor(private readonly settlementStream: SettlementStreamService) {}

  @Sse(':id/stream')
  @ApiOperation({ summary: 'Stream settlement status updates via Server-Sent Events' })
  streamStatus(@Req() req: any, @Param('id') id: string): Observable<MessageEvent> {
    return this.settlementStream.streamSettlement(req.user.merchantId, id);
  }
}
