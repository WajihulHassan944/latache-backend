import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Length, ValidateIf } from 'class-validator';
import { CAPTCHA_TOKEN_API_PROPERTY, isTurnstileEnabled, trim } from './common-auth.dto';
import { EmailDto } from './email.dto';

export class ForgotPasswordDto extends EmailDto {
  @ApiProperty(CAPTCHA_TOKEN_API_PROPERTY)
  @ValidateIf(isTurnstileEnabled)
  @Transform(trim)
  @IsNotEmpty()
  @IsString()
  @Length(1, 2048)
  captchaToken?: string;
}
