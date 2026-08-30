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

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  @Max(500)
  radius?: number;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isElite?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @IsEnum(TaskerSort)
  sort?: TaskerSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
