import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AdminFinanceQueryDto {
  @ApiPropertyOptional({
    enum: [
      'overview',
      'transactions',
      'refunds',
      'payouts',
      'revenue',
      'earnings',
      'cash_receivables',
    ],
    default: 'overview',
  })
  @IsOptional()
  @IsIn([
    'overview',
    'transactions',
    'refunds',
    'payouts',
    'revenue',
    'earnings',
    'cash_receivables',
  ])
  view?:
    | 'overview'
    | 'transactions'
    | 'refunds'
    | 'payouts'
    | 'revenue'
    | 'earnings'
    | 'cash_receivables';

  @ApiPropertyOptional({ example: 'pending_review' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  status?: string;

  @ApiPropertyOptional({ example: 'booking_charge' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  type?: string;

  @ApiPropertyOptional({ example: 'mercia' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  search?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

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

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export class AdminPayoutActionDto {
  @ApiProperty({ enum: ['approve', 'reject', 'mark_paid', 'mark_failed'] })
  @IsIn(['approve', 'reject', 'mark_paid', 'mark_failed'])
  action!: 'approve' | 'reject' | 'mark_paid' | 'mark_failed';

  @ApiPropertyOptional({
    example: 'bank-transfer-482901',
    description: 'Required for mark_paid. Must be the actual external transfer reference.',
  })
  @IsOptional()
  @IsString()
  @Length(3, 255)
  providerReference?: string;

  @ApiPropertyOptional({ example: 'Transfer verified in bank portal.' })
  @IsOptional()
  @IsString()
  @Length(3, 1000)
  note?: string;
}
