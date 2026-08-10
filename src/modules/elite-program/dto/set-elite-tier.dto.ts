import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetEliteTierDto {
  @ApiProperty({ enum: ['standard', 'gold', 'platinum', 'diamond'] })
  @IsIn(['standard', 'gold', 'platinum', 'diamond'])
  tier!: 'standard' | 'gold' | 'platinum' | 'diamond';

  @ApiPropertyOptional({ example: 'Manual correction after compliance review.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
