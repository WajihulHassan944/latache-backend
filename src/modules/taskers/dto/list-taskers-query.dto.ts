import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Matches,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { TaskerSort } from '../../../common/enums/tasker-sort.enum';
import { ApiPropertyOptional } from '@nestjs/swagger';

const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

export class ListTaskersQueryDto {
  @ApiPropertyOptional({
    example: 'تنظيف',
    description:
      'Unicode search across Tasker name/bio and canonical or localized Service content. Arabic diacritics and common letter variants are normalized for Service translations.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 'cleaning',
    description: 'Restrict results to Taskers offering this service category slug, from GET /api/services.',
  })
  @IsOptional()
  @IsString()
  serviceSlug?: string;

  @ApiPropertyOptional({ example: '2026-08-25', description: 'Return only Taskers with an open availability slot on this date.' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @ApiPropertyOptional({ example: '14:00', description: 'Requested availability start time in 24-hour HH:mm format. Requires date.' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startTime?: string;

  @ApiPropertyOptional({ example: '16:00', description: 'Requested availability end time in 24-hour HH:mm format. Requires date and startTime.' })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endTime?: string;

  @ApiPropertyOptional({
    example: 33.5731,
    minimum: -90,
    maximum: 90,
    description:
      'Requester latitude for nearby-Tasker search. Must be provided together with lng. Only Taskers with a configured service area whose distance from this point is within both radius and their own service radius are returned.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({
    example: -7.5898,
    minimum: -180,
    maximum: 180,
    description: 'Requester longitude for nearby-Tasker search. Must be provided together with lat.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({
    example: 15,
    minimum: 1,
    maximum: 500,
    default: 100,
    description:
      'Search radius in kilometers around lat/lng. Only used together with lat/lng; defaults to the platform default radius (100 km unless reconfigured by an admin) and is clamped to the platform min/max radius policy.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(500)
  radius?: number;

  @ApiPropertyOptional({ example: true, description: 'Restrict results to Elite-tier Taskers only.' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isElite?: boolean;

  @ApiPropertyOptional({ example: 10, minimum: 0, description: 'Minimum hourly rate, inclusive.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 50, minimum: 0, description: 'Maximum hourly rate, inclusive.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({
    enum: TaskerSort,
    example: TaskerSort.RatingDescending,
    description:
      'Result ordering. Defaults to a blended Elite-rank/rating/recency order when omitted. nearest requires lat and lng and orders by distance ascending.',
  })
  @IsOptional()
  @IsEnum(TaskerSort)
  sort?: TaskerSort;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 9, minimum: 1, maximum: 100, default: 9 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
