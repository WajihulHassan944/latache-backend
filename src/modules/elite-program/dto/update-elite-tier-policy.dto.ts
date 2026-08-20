import { Transform, Type } from 'class-transformer';
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
  ArrayMaxSize,
  IsArray,
  IsBoolean,
} from 'class-validator';
import { TranslationDto } from '../../localization/translation.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class EliteTierTranslationDto extends TranslationDto {
  @IsString()
  @Transform(trim)
  @MaxLength(80)
  declare name: string;

  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(500)
  declare description?: string;
}

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
  @ApiPropertyOptional({ maxLength: 80, description: 'Canonical English tier name.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

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


  @ApiPropertyOptional({ default: false, description: 'When enabled, the maintenance worker may promote eligible Taskers into this tier without a manual request.' })
  @IsOptional()
  @IsBoolean()
  autoPromotionEnabled?: boolean;

  @ApiPropertyOptional({ default: true, description: 'When enabled, members who remain below this tier requirements past the grace period are automatically demoted one level.' })
  @IsOptional()
  @IsBoolean()
  autoDemotionEnabled?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 90, default: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(90)
  retentionGraceDays?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 30, default: 3, description: 'Cooldown after a rejected/cancelled application or upgrade before another request for the same direction.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  requestCooldownDays?: number;

  @ApiPropertyOptional({ type: [EliteTierTranslationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EliteTierTranslationDto)
  translations?: EliteTierTranslationDto[];
}
