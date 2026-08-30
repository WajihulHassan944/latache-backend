import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Length, Max, Min, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

const PATH = /^\/(?:[^\s?#]*)?$/;
const LOCALE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const HTTP_URL = /^https?:\/\/[^\s]+$/i;

export class SeoSettingsDto {
  @IsOptional() @IsString() @Length(1, 255) siteName?: string;
  @IsOptional() @IsString() @Length(1, 255) defaultTitle?: string;
  @IsOptional() @IsString() @Length(1, 1000) defaultDescription?: string;
  @IsOptional() @IsString() @Matches(HTTP_URL) @Length(1, 500) defaultCanonicalBaseUrl?: string;
  @IsOptional() @IsString() @Length(1, 1000) defaultOgImageUrl?: string;
  @IsOptional() @IsString() @Length(1, 255) defaultOgImageAlt?: string;
  @IsOptional() @IsString() @IsIn(['summary', 'summary_large_image', 'app', 'player']) twitterCard?: string;
  @IsOptional() @IsString() @Length(1, 100) twitterHandle?: string;
  @IsOptional() @IsBoolean() defaultRobotsIndex?: boolean;
  @IsOptional() @IsBoolean() defaultRobotsFollow?: boolean;
  @IsOptional() @IsObject() organizationSchema?: Record<string, unknown>;
  @IsOptional() @IsObject() defaultStructuredData?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) robotsRules?: string[];
  @IsOptional() @IsBoolean() sitemapEnabled?: boolean;
  @IsOptional() @IsBoolean() includeServices?: boolean;
  @IsOptional() @IsBoolean() includePublicTaskers?: boolean;
  @IsOptional() @IsString() @Length(1, 255) servicePathTemplate?: string;
  @IsOptional() @IsString() @Length(1, 255) taskerPathTemplate?: string;
}

export class UpsertSeoPageDto {
  @IsString() @Matches(PATH) @Length(1, 500) path!: string;
  @IsString() @Matches(LOCALE) @Length(2, 10) locale!: string;
  @IsOptional() @IsString() @Length(1, 255) title?: string;
  @IsOptional() @IsString() @Length(1, 1000) description?: string;
  @IsOptional() @IsString() @Length(1, 1000) canonicalUrl?: string;
  @IsOptional() @IsBoolean() robotsIndex?: boolean;
  @IsOptional() @IsBoolean() robotsFollow?: boolean;
  @IsOptional() @IsString() @Length(1, 255) ogTitle?: string;
  @IsOptional() @IsString() @Length(1, 1000) ogDescription?: string;
  @IsOptional() @IsString() @Length(1, 1000) ogImageUrl?: string;
  @IsOptional() @IsString() @Length(1, 255) ogImageAlt?: string;
  @IsOptional() @IsString() @IsIn(['summary', 'summary_large_image', 'app', 'player']) twitterCard?: string;
  @IsOptional() @IsString() @Length(1, 255) twitterTitle?: string;
  @IsOptional() @IsString() @Length(1, 1000) twitterDescription?: string;
  @IsOptional() @IsString() @Length(1, 1000) twitterImageUrl?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) keywords?: string[];
  @IsOptional() @IsObject() structuredData?: Record<string, unknown>;
  @IsOptional() @IsObject() alternates?: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) priority?: number;
  @IsOptional() @IsString() @IsIn(['always','hourly','daily','weekly','monthly','yearly','never']) changeFrequency?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SeoPageListQueryDto {
  @IsOptional() @IsString() @Length(1, 500) search?: string;
  @IsOptional() @IsString() @Matches(LOCALE) locale?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class SeoRedirectDto {
  @IsString() @Matches(PATH) @Length(1, 500) fromPath!: string;
  @IsString() @Length(1, 1000) toPath!: string;
  @Type(() => Number) @IsInt() @IsIn([301,302,307,308]) statusCode!: number;
  @IsOptional() @IsBoolean() preserveQuery?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() @Length(1, 500) reason?: string;
}

export class SeoSitemapEntryDto {
  @IsString() @Matches(PATH) @Length(1, 1000) path!: string;
  @IsOptional() @IsString() @Matches(LOCALE) locale?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) priority?: number;
  @IsOptional() @IsString() @IsIn(['always','hourly','daily','weekly','monthly','yearly','never']) changeFrequency?: string;
  @IsOptional() @Type(() => String) @IsString() lastModifiedAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class SeoResolveQueryDto {
  @IsString() @Length(1, 500) path!: string;
  @IsOptional() @IsString() @Matches(LOCALE) locale?: string;
}
