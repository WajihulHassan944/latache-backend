import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ArrayMaxSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SERVICE_ICON_VALUES } from '../../../common/constants/service-icon.constant';
import { TranslationDto } from '../../localization/translation.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const trimBullets = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim() : item))
        .filter((item) => item !== '')
    : value;

export class ServiceTranslationDto extends TranslationDto {
  @ApiPropertyOptional({
    type: [String],
    example: [
      'Installation and repair of electrical fixtures, outlets, and switches.',
      'Fault diagnosis and circuit troubleshooting in residential and commercial settings.',
    ],
    description: 'Typical scope-of-work bullets for this service, in this locale.',
  })
  @IsOptional()
  @Transform(trimBullets)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  scope?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Multimeter / voltage tester', 'Wire strippers and crimping tools'],
    description: 'Recommended-tools-to-bring bullets for this service, in this locale.',
  })
  @IsOptional()
  @Transform(trimBullets)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  tools?: string[];
}

export class CreateServiceDto {
  @ApiProperty({ example: 'Home Cleaning' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({ example: 'Professional home cleaning services.' })
  @Transform(trim)
  @IsString()
  @Length(2, 1000)
  description!: string;

  @ApiPropertyOptional({
    type: [String],
    example: [
      'Installation and repair of electrical fixtures, outlets, and switches.',
      'Fault diagnosis and circuit troubleshooting in residential and commercial settings.',
    ],
    description: 'Canonical English typical-scope-of-work bullets.',
  })
  @IsOptional()
  @Transform(trimBullets)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  scope?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Multimeter / voltage tester', 'Wire strippers and crimping tools'],
    description: 'Canonical English recommended-tools-to-bring bullets.',
  })
  @IsOptional()
  @Transform(trimBullets)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  tools?: string[];

  @ApiProperty({ example: 'home-cleaning' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiProperty({
    enum: SERVICE_ICON_VALUES,
    example: 'Zap',
    description:
      'Icon key identifying this service, rendered by the frontend via a shared lucide-react icon lookup keyed by this exact value. Tied to the service itself - never to its position in a list - so reordering or filtering services can never mismatch the icon shown. Must be one of the values returned by GET /api/admin/services?view=icons.',
  })
  @Transform(trim)
  @IsString()
  @IsIn(SERVICE_ICON_VALUES)
  icon!: string;

  @ApiProperty({ example: 15, minimum: 0.01, description: 'Minimum Tasker hourly rate in the current platform currency.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  minimumHourlyRate!: number;

  @ApiProperty({ example: 100, minimum: 0.01, description: 'Maximum Tasker hourly rate in the current platform currency.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  maximumHourlyRate!: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [ServiceTranslationDto],
    example: [{ locale: 'ar', name: 'تنظيف المنزل', description: 'خدمات تنظيف احترافية.' }],
    description:
      'Additional configured translations. name/description/scope/tools remain canonical English.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ServiceTranslationDto)
  translations?: ServiceTranslationDto[];
}

export class UpdateServiceDto {
  @ApiPropertyOptional({ example: 'Home Cleaning' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ example: 'Professional home cleaning services.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 1000)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    example: [
      'Installation and repair of electrical fixtures, outlets, and switches.',
      'Fault diagnosis and circuit troubleshooting in residential and commercial settings.',
    ],
    description: 'Canonical English typical-scope-of-work bullets.',
  })
  @IsOptional()
  @Transform(trimBullets)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  scope?: string[];

  @ApiPropertyOptional({
    type: [String],
    example: ['Multimeter / voltage tester', 'Wire strippers and crimping tools'],
    description: 'Canonical English recommended-tools-to-bring bullets.',
  })
  @IsOptional()
  @Transform(trimBullets)
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @Length(1, 500, { each: true })
  tools?: string[];

  @ApiPropertyOptional({ example: 'home-cleaning' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @ApiPropertyOptional({
    enum: SERVICE_ICON_VALUES,
    example: 'Zap',
    description:
      'Icon key identifying this service, rendered by the frontend via a shared lucide-react icon lookup keyed by this exact value. Tied to the service itself - never to its position in a list - so reordering or filtering services can never mismatch the icon shown. Must be one of the values returned by GET /api/admin/services?view=icons.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsIn(SERVICE_ICON_VALUES)
  icon?: string;

  @ApiPropertyOptional({ minimum: 0.01, description: 'Minimum Tasker hourly rate in the current platform currency.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  minimumHourlyRate?: number;

  @ApiPropertyOptional({ minimum: 0.01, description: 'Maximum Tasker hourly rate in the current platform currency.' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(1000000)
  maximumHourlyRate?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [ServiceTranslationDto],
    description:
      'Upserts locale rows. An en row updates the canonical English fallback; missing locales are unchanged.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ServiceTranslationDto)
  translations?: ServiceTranslationDto[];
}
