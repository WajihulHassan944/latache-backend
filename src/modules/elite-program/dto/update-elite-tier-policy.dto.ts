import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class EliteTierRequirementsDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 5, example: 4.8 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ minimum: 0, example: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minCompletedTasks?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, example: 95 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  minCompletionRate?: number;

  @ApiPropertyOptional({ minimum: 0, example: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxOpenComplaints?: number;

  @ApiPropertyOptional({ minimum: 0, example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minSettledEarnings?: number;
}

export class UpdateEliteTierPolicyDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ type: EliteTierRequirementsDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => EliteTierRequirementsDto)
  requirements?: EliteTierRequirementsDto | null;
}
