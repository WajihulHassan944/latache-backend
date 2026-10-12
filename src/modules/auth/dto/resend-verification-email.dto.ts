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

  @ApiProperty(CAPTCHA_TOKEN_API_PROPERTY)
  @ValidateIf(isTurnstileEnabled)
  @Transform(trim)
  @IsNotEmpty()
  @IsString()
  @Length(1, 2048)
  captchaToken?: string;
}
