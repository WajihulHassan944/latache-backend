import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListReviewsQueryDto {
  @ApiPropertyOptional({ enum: ['received', 'given'], default: 'received' })
  @IsOptional()
  @IsIn(['received', 'given'])
  view?: 'received' | 'given';

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CreateReviewDto {
  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ example: 'Clear communication and excellent work.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class UpdateReviewDto extends CreateReviewDto {}

export class ReviewBookingParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId!: number;
}

export class ReviewIdParamDto {
  id!: string;
}
