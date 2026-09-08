import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';
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

  @ApiPropertyOptional({ example: 'Casablanca', description: 'Text search across this customer\'s past booking addresses (venue, label, city, area).' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  location?: string;

  @ApiPropertyOptional({
    example: '203.0.113.5',
    description:
      'Exact match against any session IP address ever recorded for the customer (see RefreshToken). Requires customers.read_sensitive.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ipAddress?: string;

  @ApiPropertyOptional({
    example: 33.6844,
    minimum: -90,
    maximum: 90,
    description:
      'Latitude of the area to search around, using each customer\'s own saved location (see PATCH /auth/me/location). Must be provided together with nearLng. Requires customers.read_sensitive.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  nearLat?: number;

  @ApiPropertyOptional({
    example: 73.0479,
    minimum: -180,
    maximum: 180,
    description: 'Longitude of the area to search around. Must be provided together with nearLat.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  nearLng?: number;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 500,
    default: 20,
    description: 'Search radius in kilometers around nearLat/nearLng. Only used together with them.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(500)
  radiusKm?: number;

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
