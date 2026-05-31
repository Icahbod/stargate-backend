import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post()
  @ApiOperation({ summary: 'Register webhook' })
  create(@Req() req: any, @Body() body: unknown) {
    const actorIp = req.ip || req.connection.remoteAddress;
    return this.webhooks.create(req.user.merchantId, body, actorIp, req.user.email);
  }

  @Get()
  @ApiOperation({ summary: 'List merchant webhooks' })
  list(@Req() req: any) {
    return this.webhooks.list(req.user.merchantId);
  }

  @Post(':id/rotate-secret')
  @ApiOperation({ summary: 'Rotate webhook signing secret with 24-hour overlap window' })
  rotateSecret(@Req() req: any, @Param('id') id: string) {
    return this.webhooks.rotateSecret(req.user.merchantId, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate webhook' })
  remove(@Req() req: any, @Param('id') id: string) {
    const actorIp = req.ip || req.connection.remoteAddress;
    return this.webhooks.deactivate(req.user.merchantId, id, actorIp, req.user.email);
  }

  @Get(':id/deliveries')
  @ApiOperation({ summary: 'List delivery attempts for a webhook' })
  deliveries(@Req() req: any, @Param('id') id: string) {
    return this.webhooks.deliveries(req.user.merchantId, id);
  }

  @Get(':id/deliveries/:deliveryId')
  @ApiOperation({ summary: 'Get a single delivery attempt by ID' })
  delivery(@Req() req: any, @Param('id') id: string, @Param('deliveryId') deliveryId: string) {
    return this.webhooks.deliveryById(req.user.merchantId, id, deliveryId);
  }

  @Post(':id/deliveries/:deliveryId/replay')
  @ApiOperation({ summary: 'Replay a failed delivery' })
  replay(@Req() req: any, @Param('id') id: string, @Param('deliveryId') deliveryId: string) {
    const actorIp = req.ip || req.connection.remoteAddress;
    return this.webhooks.replay(req.user.merchantId, id, deliveryId, actorIp, req.user.email);
  }

  @Post('deliveries/:id/retry')
  @ApiOperation({ summary: 'Retry a failed or dead delivery' })
  retry(@Req() req: any, @Param('id') id: string) {
    const actorIp = req.ip || req.connection.remoteAddress;
    return this.webhooks.retry(req.user.merchantId, id, actorIp, req.user.email);
  }

  @Get(':id/health')
  @ApiOperation({ summary: 'Webhook health: success rate, latency p99, last failure' })
  health(@Req() req: any, @Param('id') id: string) {
    return this.webhooks.health(req.user.merchantId, id);
  }
}
