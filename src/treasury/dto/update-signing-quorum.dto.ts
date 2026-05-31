import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class UpdateSigningQuorumDto {
  @ApiProperty({
    description: 'The required number of treasury signatures needed to approve a transaction',
    example: 2,
  })
  @IsInt()
  @Min(1)
  signingQuorum: number;
}
