import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Role } from '../../auth/roles.enum';

export class InviteMemberDto {
  @ApiProperty({ example: 'dev@company.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'Alice Dev' })
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiProperty({ enum: [Role.ADMIN, Role.DEVELOPER, Role.VIEWER] })
  @IsEnum([Role.ADMIN, Role.DEVELOPER, Role.VIEWER])
  role!: Role.ADMIN | Role.DEVELOPER | Role.VIEWER;
}
