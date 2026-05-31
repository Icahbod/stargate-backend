import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../auth/roles.enum';

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: [Role.ADMIN, Role.DEVELOPER, Role.VIEWER] })
  @IsEnum([Role.ADMIN, Role.DEVELOPER, Role.VIEWER])
  role!: Role.ADMIN | Role.DEVELOPER | Role.VIEWER;
}
