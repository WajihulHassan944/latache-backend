import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateGuestTokenDto {
  @ApiPropertyOptional({
    example: 'a1b2c3d4-e5f6-4a1b-9c3d-1234567890ab',
    maxLength: 255,
    description:
      'Optional client-generated device identifier, stored for analytics/rate-limiting correlation only. It never causes an existing session to be reused; every call creates a new guest session.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  deviceId?: string;
}
