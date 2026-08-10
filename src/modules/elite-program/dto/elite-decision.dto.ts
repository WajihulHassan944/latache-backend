import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class EliteDecisionDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  action!: 'approve' | 'reject';

  @ApiPropertyOptional({ example: 'Performance and compliance review completed.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
