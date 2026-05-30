import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BalanceService, BalanceResponse } from './balance.service';

@ApiTags('balance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('balance')
export class BalanceController {
  constructor(private readonly balance: BalanceService) {}

  @Get()
  @ApiOperation({ summary: 'Get merchant balance including on-chain and pending settlement amounts' })
  async getBalance(@Req() req: any): Promise<BalanceResponse> {
    return this.balance.getMerchantBalance(req.user.merchantId);
  }
}
