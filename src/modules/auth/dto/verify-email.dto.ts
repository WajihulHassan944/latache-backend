import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { EmailDto } from './email.dto';
import { trim } from './common-auth.dto';

export class VerifyEmailDto extends EmailDto {
  @ApiProperty({ example: '123456', description: 'Latest six-digit email verification OTP.' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must contain exactly 6 digits' })
  otp!: string;

  @ApiPropertyOptional({ example: 'Chrome on Windows', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  device?: string;
}
