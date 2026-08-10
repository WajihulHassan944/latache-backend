import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { AdminPaginationDto } from './admin-pagination.dto';

export const ADMIN_BOOKING_VIEWS = [
  'all',
  'pending',
  'accepted',
  'in_progress',
  'completed',
  'cancelled',
  'disputed',
] as const;

export class AdminBookingsQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({ enum: ADMIN_BOOKING_VIEWS, default: 'all' })
  @IsOptional()
  @IsIn(ADMIN_BOOKING_VIEWS)
  view?: (typeof ADMIN_BOOKING_VIEWS)[number] = 'all';

  @ApiPropertyOptional({
    example: 'B-8291, plumbing, Alice or Robert',
    description: 'Searches booking id, service, customer and tasker identity.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  search?: string;

  @ApiPropertyOptional({ type: Number, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceId?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  customerId?: number;

  @ApiPropertyOptional({ type: Number, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskerId?: number;

  @ApiPropertyOptional({
    enum: [
      'all',
      'payment_method_required',
      'ready',
      'processing',
      'paid',
      'failed',
      'requires_action',
      'on_hold_dispute',
      'partially_refunded',
      'refunded',
    ],
    default: 'all',
  })
  @IsOptional()
  @IsIn([
    'all',
    'payment_method_required',
    'ready',
    'processing',
    'paid',
    'failed',
    'requires_action',
    'on_hold_dispute',
    'partially_refunded',
    'refunded',
  ])
  paymentStatus?: string = 'all';

  @ApiPropertyOptional({ example: '2026-08-01', description: 'UTC booking date, inclusive. Supply with to.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31', description: 'UTC booking date, inclusive. Supply with from.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'amount_desc', 'amount_asc'], default: 'newest' })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'amount_desc', 'amount_asc'])
  sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc' = 'newest';

  @ApiPropertyOptional({
    enum: ['json', 'csv'],
    default: 'json',
    description: 'CSV uses the same filters and is capped to a safe export size.',
  })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv' = 'json';
}

export class AdminBookingActionDto {
  @ApiProperty({
    enum: ['cancel'],
    description: 'Admin lifecycle actions are intentionally narrow. Financial dispute outcomes belong to the dispute API.',
  })
  @IsIn(['cancel'])
  action!: 'cancel';

  @ApiProperty({ example: 'Customer and Tasker both confirmed the booking should be cancelled.' })
  @IsString()
  @MaxLength(1000)
  reason!: string;
}
