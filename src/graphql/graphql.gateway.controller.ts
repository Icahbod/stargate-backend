import { Body, Controller, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GraphqlGatewayService } from './graphql.gateway.service';

@ApiTags('graphql')
@Controller('graphql')
@UseGuards(JwtAuthGuard)
export class GraphqlGatewayController {
  constructor(
    private readonly config: ConfigService,
    private readonly graphqlGateway: GraphqlGatewayService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Execute GraphQL queries against the opt-in REST gateway' })
  async execute(@Req() req: any, @Body() body: { query: string; variables?: Record<string, unknown> }) {
    if (!this.config.get<boolean>('GRAPHQL_GATEWAY_ENABLED')) {
      throw new NotFoundException('GraphQL gateway is disabled');
    }

    return this.graphqlGateway.execute(body.query, body.variables, { user: req.user });
  }
}
