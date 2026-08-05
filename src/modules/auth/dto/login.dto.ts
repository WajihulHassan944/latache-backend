import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { normalizeEmail, trim } from './common-auth.dto';

export class LoginDto {
  @ApiProperty({ example: 'user@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Admin@12345' })
  @IsString()
  @Length(1, 128)
  password!: string;

  @ApiPropertyOptional({ enum: UserRole, description: 'Optional portal-role assertion.' })
  @IsOptional()
  @IsEnum(UserRole)
  expectedRole?: UserRole;

  @ApiPropertyOptional({ example: 'Chrome on Windows' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  device?: string;
}
