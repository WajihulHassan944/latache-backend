import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
}
