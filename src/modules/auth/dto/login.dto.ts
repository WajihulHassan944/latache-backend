import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
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

  @ApiProperty(CAPTCHA_TOKEN_API_PROPERTY)
  @ValidateIf(isTurnstileEnabled)
  @Transform(trim)
  @IsNotEmpty()
  @IsString()
  @Length(1, 2048)
  captchaToken?: string;
}
