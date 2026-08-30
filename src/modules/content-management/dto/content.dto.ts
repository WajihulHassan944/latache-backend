import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ContentPageTranslationDto {
  @IsString()
  @Matches(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
  locale!: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  seoDescription?: string;
}

export class ContentBlockTranslationDto {
  @IsString()
  @Matches(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
  locale!: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @Length(0, 10000)
  body?: string;

  @ApiPropertyOptional({ description: 'Structured locale-specific content for future block types.' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

export class CreateContentBlockDto {
  @IsString()
  @Length(1, 120)
  @Matches(/^[a-zA-Z0-9_-]+$/)
  key!: string;

  @IsString()
  @Length(1, 64)
  type!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Structured block data. The schema is intentionally extensible for future homepage/page components.' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContentBlockTranslationDto)
  translations?: ContentBlockTranslationDto[];
}

export class UpdateContentBlockDto {
  @IsOptional()
  @IsString()
  @Length(1, 64)
  type?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Structured block data. Existing fields are preserved when omitted.' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContentBlockTranslationDto)
  translations?: ContentBlockTranslationDto[];
}

export class CreateContentPageDto {
  @IsString()
  @Length(2, 120)
  @Matches(SLUG)
  slug!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  pageType?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  seoDescription?: string;

  @ApiPropertyOptional({ description: 'Page-level structured metadata for future CMS capabilities.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContentPageTranslationDto)
  translations?: ContentPageTranslationDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateContentBlockDto)
  blocks?: CreateContentBlockDto[];
}

export class UpdateContentPageDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  @Matches(SLUG)
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  pageType?: string;

  @IsOptional()
  @IsString()
  @Length(1, 255)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  seoTitle?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  seoDescription?: string;

  @ApiPropertyOptional({ description: 'Page-level structured metadata for future CMS capabilities.' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContentPageTranslationDto)
  translations?: ContentPageTranslationDto[];
}

export class ContentListQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'published', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['draft', 'published', 'all'])
  status?: 'draft' | 'published' | 'all';

  @IsOptional()
  @IsString()
  @Length(0, 120)
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
