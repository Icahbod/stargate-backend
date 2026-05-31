import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationPreferencesService } from './notification-preferences.service';

@ApiTags('notification-preferences')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notification-preferences')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'List notification preferences for all event types' })
  list(@Req() req: any) {
    return this.preferences.list(req.user.merchantId);
  }

  @Get(':eventType')
  @ApiOperation({ summary: 'Get notification preferences for one event type' })
  get(@Req() req: any, @Param('eventType') eventType: string) {
    return this.preferences.get(req.user.merchantId, eventType as any);
  }

  @Post()
  @ApiOperation({ summary: 'Create or update notification preferences for an event type' })
  upsert(@Req() req: any, @Body() body: unknown) {
    return this.preferences.upsert(req.user.merchantId, body);
  }

  @Delete(':eventType')
  @ApiOperation({ summary: 'Delete notification preferences for an event type' })
  remove(@Req() req: any, @Param('eventType') eventType: string) {
    return this.preferences.remove(req.user.merchantId, eventType as any);
  }
}
