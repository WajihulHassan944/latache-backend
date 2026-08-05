import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_PATTERN,
} from '../../../common/constants/security.constants';
import { VerifyResetOtpDto } from './verify-reset-otp.dto';

export class ResetPasswordDto extends VerifyResetOtpDto {
  @ApiProperty({ example: 'NewPassword@123' })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  @Matches(PASSWORD_PATTERN, {
    message: 'newPassword must contain a letter, a number, and a special character',
  })
  newPassword!: string;
}
