import { BadRequestException, Body, Controller, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/roles.enum';
import { KmsSignerService } from '../stellar/kms-signer.service';
import { TreasuryService } from './treasury.service';
import { UpdateSigningQuorumDto } from './dto/update-signing-quorum.dto';

@ApiTags('treasury')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('treasury')
export class TreasuryController {
  constructor(
    private readonly kms: KmsSignerService,
    private readonly treasury: TreasuryService,
  ) {}

  @Post('sign')
  @ApiOperation({ summary: 'Submit treasury approval digest for KMS signing' })
  async sign(@Body() body: { digest: string }) {
    if (!body?.digest) throw new BadRequestException('digest is required');
    const bytes = Buffer.from(body.digest, 'hex');
    if (bytes.length !== 32) throw new BadRequestException('digest must be a 32-byte hex string');
    const signature = await this.kms.signDigest(bytes);
    return { signature: Buffer.from(signature).toString('hex') };
  }

  @Patch('signing-quorum')
  @UseGuards(JwtAuthGuard, AdminGuard, RolesGuard)
  @Roles(Role.OWNER, Role.ADMIN)
  @ApiOperation({ summary: 'Update the treasury signing quorum for governance approvals' })
  async updateSigningQuorum(@Body() body: UpdateSigningQuorumDto) {
    return this.treasury.setSigningQuorum(body.signingQuorum);
  }
}
