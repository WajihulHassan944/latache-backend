import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AdminReviewsQueryDto {
  @IsOptional()
  @IsIn(['all', 'visible', 'hidden'])
  status?: 'all' | 'visible' | 'hidden';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  reviewerId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  revieweeId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

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

export class AdminReviewModerationDto {
  @IsIn(['hide', 'restore'])
  action!: 'hide' | 'restore';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
