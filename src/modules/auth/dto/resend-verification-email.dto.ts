import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { EmailDto } from './email.dto';
import { trim } from './common-auth.dto';

export class ResendVerificationEmailDto extends EmailDto {
  @ApiPropertyOptional({ example: 'Chrome on Windows', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  device?: string;
}
