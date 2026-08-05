import { IsOptional, IsString, MaxLength } from 'class-validator';
import { EmailDto } from './email.dto';

export class ResendOtpDto extends EmailDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  device?: string;
}
