import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { AdminPaginationDto } from './admin-pagination.dto';

export class AdminActivityQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({ enum: ['all', 'users', 'bookings', 'payments', 'admin'], default: 'all' })
  @IsOptional()
  @IsIn(['all', 'users', 'bookings', 'payments', 'admin'])
  category?: 'all' | 'users' | 'bookings' | 'payments' | 'admin' = 'all';
}
