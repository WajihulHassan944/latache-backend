import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ConfirmCashCollectionDto {
  @ApiProperty({
    example: 100,
    description:
      'Actual cash physically received by the Tasker. Must equal the immutable final booking charge snapshot.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  collectedAmount!: number;
}

export class TaskerEarningsQueryDto {
  @ApiPropertyOptional({
    enum: ['pending', 'available', 'partially_reversed', 'reversed'],
  })
  @IsOptional()
  @IsIn(['pending', 'available', 'partially_reversed', 'reversed'])
  status?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class AdminEarningActionDto {
  @ApiProperty({ enum: ['block', 'unblock', 'extend_clearance'] })
  @IsIn(['block', 'unblock', 'extend_clearance'])
  action!: 'block' | 'unblock' | 'extend_clearance';

  @ApiProperty({ example: 'Active dispute requires finance review.' })
  @IsString()
  @Length(5, 1000)
  reason!: string;

  @ApiPropertyOptional({
    example: '2026-09-15T12:00:00.000Z',
    description:
      'Required for extend_clearance and must be later than the current effective clearance.',
  })
  @IsOptional()
  @IsDateString()
  holdUntil?: string;
}
