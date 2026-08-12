import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminPaginationDto } from './admin-pagination.dto';

export class AdminCustomerBookingsQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({
    enum: [
      'all',
      'pending',
      'confirmed',
      'en_route',
      'arrived',
      'in_progress',
      'completed',
      'cancelled',
    ],
    default: 'all',
  })
  @IsOptional()
  @IsIn([
    'all',
    'pending',
    'confirmed',
    'en_route',
    'arrived',
    'in_progress',
    'completed',
    'cancelled',
  ])
  status?: string = 'all';

  @ApiPropertyOptional({
    example: 'Sarah or BKG-1042',
    description: 'Admin-wide list only; filters customer name/email or numeric booking id.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}

export class AdminCustomerPaymentsQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({
    enum: ['all', 'pending', 'processing', 'succeeded', 'failed'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'pending', 'processing', 'succeeded', 'failed'])
  status?: string = 'all';

  @ApiPropertyOptional({
    enum: ['all', 'booking_charge', 'wallet_topup', 'refund'],
    default: 'all',
  })
  @IsOptional()
  @IsIn(['all', 'booking_charge', 'wallet_topup', 'refund'])
  kind?: string = 'all';

  @ApiPropertyOptional({
    example: 'Sarah or pi_...',
    description: 'Admin-wide list only; filters customer or provider reference.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
