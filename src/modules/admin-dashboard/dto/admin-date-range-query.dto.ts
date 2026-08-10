import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';

export const ADMIN_ANALYTICS_RANGES = ['7d', '30d', '90d', '6m', '12m', 'all'] as const;
export type AdminAnalyticsRange = (typeof ADMIN_ANALYTICS_RANGES)[number];

export class AdminDateRangeQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_ANALYTICS_RANGES, default: '30d' })
  @IsOptional()
  @IsIn(ADMIN_ANALYTICS_RANGES)
  range?: AdminAnalyticsRange = '30d';

  @ApiPropertyOptional({ example: '2026-01-01', description: 'UTC date. Supply both from and to to override range.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-08', description: 'UTC date, inclusive. Supply both from and to.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
