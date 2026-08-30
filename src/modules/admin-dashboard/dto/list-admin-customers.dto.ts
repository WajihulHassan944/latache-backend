import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdminPaginationDto } from './admin-pagination.dto';
import { IsDateOnly } from '../../../common/validators/is-date-only.validator';

export class ListAdminCustomersDto extends AdminPaginationDto {
  @ApiPropertyOptional({ example: 'sarah' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;


  @ApiPropertyOptional({ example: '+923001234567' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional({ example: 'Casablanca' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  location?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateOnly()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-20' })
  @IsOptional()
  @IsDateOnly()
  to?: string;

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
