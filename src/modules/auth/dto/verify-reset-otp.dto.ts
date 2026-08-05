import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { EmailDto } from './email.dto';

export class VerifyResetOtpDto extends EmailDto {
  @ApiProperty({ example: '334018', description: 'Latest six-digit password-reset OTP.' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must contain exactly 6 digits' })
  otp!: string;
}
