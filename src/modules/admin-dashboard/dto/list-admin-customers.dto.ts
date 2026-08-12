import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminPaginationDto } from './admin-pagination.dto';

export class ListAdminCustomersDto extends AdminPaginationDto {
  @ApiPropertyOptional({ example: 'sarah' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: ['active', 'pending_verification', 'suspended', 'deactivated'] })
  @IsOptional()
  @IsIn(['active', 'pending_verification', 'suspended', 'deactivated'])
  status?: string;

  @ApiPropertyOptional({
    enum: ['newest', 'oldest', 'bookings_desc', 'rating_desc'],
    default: 'newest',
  })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'bookings_desc', 'rating_desc'])
  sort?: 'newest' | 'oldest' | 'bookings_desc' | 'rating_desc' = 'newest';
}
