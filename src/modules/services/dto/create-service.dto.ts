import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
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
import { TranslationDto } from '../../localization/translation.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

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

  @ApiProperty({ example: 'home-cleaning' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/demo/image/upload/service.webp' })
  @Transform(trim)
  @IsString()
  @Length(1, 2048)
  icon!: string;

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
    type: [TranslationDto],
    example: [{ locale: 'ar', name: 'تنظيف المنزل', description: 'خدمات تنظيف احترافية.' }],
    description: 'Additional configured translations. name/description remain canonical English.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TranslationDto)
  translations?: TranslationDto[];
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

  @ApiPropertyOptional({ example: 'home-cleaning' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug?: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/demo/image/upload/service.webp' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 2048)
  icon?: string;

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
    type: [TranslationDto],
    description:
      'Upserts locale rows. An en row updates the canonical English fallback; missing locales are unchanged.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => TranslationDto)
  translations?: TranslationDto[];
}
