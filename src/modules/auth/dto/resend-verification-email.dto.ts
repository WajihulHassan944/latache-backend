import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Length, MaxLength, ValidateIf } from 'class-validator';
import { EmailDto } from './email.dto';
import { CAPTCHA_TOKEN_API_PROPERTY, isTurnstileEnabled, trim } from './common-auth.dto';

export class ResendVerificationEmailDto extends EmailDto {
  @ApiPropertyOptional({ example: 'Chrome on Windows', maxLength: 255 })
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
