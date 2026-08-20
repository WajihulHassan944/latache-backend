import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { trim } from './common-auth.dto';

export class SwitchRoleDto {
  @ApiProperty({ enum: [UserRole.Customer, UserRole.Tasker], example: UserRole.Tasker })
  @IsEnum(UserRole)
  role!: UserRole;

  @ApiPropertyOptional({ example: 'iPhone 16 Pro' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  device?: string;
}
