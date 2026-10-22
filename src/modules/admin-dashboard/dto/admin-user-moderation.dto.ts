import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AdminUserModerationDto {
  @ApiProperty({ enum: ['suspend', 'reactivate', 'ban'] })
  @IsIn(['suspend', 'reactivate', 'ban'])
  action!: 'suspend' | 'reactivate' | 'ban';

  @ApiPropertyOptional({ example: 'Repeated policy violations' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({
    example: '2026-11-01T00:00:00.000Z',
    description:
      'ISO 8601 datetime at which a suspension automatically lifts. Only valid together with action=suspend, and must be in the future.',
  })
  @IsOptional()
  @IsISO8601()
  until?: string;
}
