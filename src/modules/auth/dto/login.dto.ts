import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum';
import {
  CAPTCHA_TOKEN_API_PROPERTY,
  isTurnstileEnabled,
  normalizeEmail,
  trim,
} from './common-auth.dto';

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

  @ApiPropertyOptional({
    enum: UserRole,
    description:
      'Role to activate for this login. Required when one identity owns multiple marketplace roles.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    enum: UserRole,
    deprecated: true,
    description: 'Backward-compatible alias for role.',
  })
  @IsOptional()
  @IsEnum(UserRole)
  expectedRole?: UserRole;

  @ApiPropertyOptional({ example: 'Chrome on Windows' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  device?: string;

  @ApiPropertyOptional({
    example: '6f1c2d9a-4b7e-4f0a-9c1e-3a5d8e2b7c40',
    minLength: 16,
    maxLength: 64,
    description: 'Stable per-install device identifier generated once by the app. Used so one device holds one session.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(16, 64)
  deviceId?: string;

  @ApiPropertyOptional({
    example: 'Samsung SM-A546E · Android 14',
    maxLength: 255,
    description: 'Human-readable phone model and OS shown in the sessions list.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  deviceName?: string;

  @ApiProperty(CAPTCHA_TOKEN_API_PROPERTY)
  @ValidateIf(isTurnstileEnabled)
  @Transform(trim)
  @IsNotEmpty()
  @IsString()
  @Length(1, 2048)
  captchaToken?: string;
}
