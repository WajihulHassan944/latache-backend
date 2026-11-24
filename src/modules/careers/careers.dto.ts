import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { CANDIDATE_EMAIL_TEMPLATES } from './careers-email.template';

export const WORK_MODES = ['onsite', 'hybrid', 'remote'] as const;
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship'] as const;
export const SENIORITIES = ['junior', 'mid', 'senior', 'lead'] as const;
export const JOB_STATUSES = ['draft', 'open', 'closed'] as const;
export const APPLICATION_STAGES = ['new', 'screening', 'interview', 'offer', 'hired', 'rejected'] as const;

const trim = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.trim() : value);
const toBool = ({ value }: { value: unknown }): unknown => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value);
const lines = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '') : value;

export class PublicJobsQueryDto {
  @ApiPropertyOptional({ example: 'designer' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) department?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional({ enum: WORK_MODES }) @IsOptional() @IsIn(WORK_MODES) workMode?: (typeof WORK_MODES)[number];
  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES }) @IsOptional() @IsIn(EMPLOYMENT_TYPES) employmentType?: (typeof EMPLOYMENT_TYPES)[number];
  @ApiPropertyOptional({ enum: SENIORITIES }) @IsOptional() @IsIn(SENIORITIES) seniority?: (typeof SENIORITIES)[number];
  @ApiPropertyOptional({ enum: ['relevant', 'newest', 'title'], default: 'relevant' }) @IsOptional() @IsIn(['relevant', 'newest', 'title']) sort?: 'relevant' | 'newest' | 'title';
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 12 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

/** multipart/form-data fields (everything arrives as a string). */
export class ApplyDto {
  @ApiPropertyOptional({ description: 'Slug of the role. Omit for a general application (talent pool).' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) jobSlug?: string;

  @ApiProperty({ example: 'Fatima Ait Ben' }) @Transform(trim) @IsString() @Length(2, 160) fullName!: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(255) email!: string;
  @ApiProperty({ example: '+212612345678' }) @Transform(trim) @Matches(/^\+?[0-9 ()-]{7,24}$/, { message: 'Enter a valid phone number' }) phone!: string;
  @ApiProperty({ example: 'Casablanca' }) @Transform(trim) @IsString() @Length(2, 80) city!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) @MaxLength(300) linkedinUrl?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsUrl({ require_protocol: true, protocols: ['http', 'https'] }) @MaxLength(300) portfolioUrl?: string;
  @ApiProperty({ minLength: 20, maxLength: 3000 }) @Transform(trim) @IsString() @Length(20, 3000) coverNote!: string;
  @ApiPropertyOptional({ example: 'linkedin' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(40) source?: string;
  @ApiProperty({ description: 'Must be "true" - consent to process the application data.' }) @Transform(toBool) @IsBoolean() consent!: boolean;
  /** Honeypot: real users never see or fill it. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) website?: string;
  @ApiPropertyOptional({ description: 'Cloudflare Turnstile token (required when Turnstile is enabled).' }) @IsOptional() @IsString() @MaxLength(4096) captchaToken?: string;
}

export class JobUpsertDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(3, 160) title!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) department!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(2, 80) city!: string;
  @ApiProperty({ enum: WORK_MODES }) @IsIn(WORK_MODES) workMode!: (typeof WORK_MODES)[number];
  @ApiProperty({ enum: EMPLOYMENT_TYPES }) @IsIn(EMPLOYMENT_TYPES) employmentType!: (typeof EMPLOYMENT_TYPES)[number];
  @ApiProperty({ enum: SENIORITIES }) @IsIn(SENIORITIES) seniority!: (typeof SENIORITIES)[number];
  @ApiProperty() @Transform(trim) @IsString() @Length(10, 500) summary!: string;
  @ApiProperty({ type: [String] }) @Transform(lines) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(400, { each: true }) responsibilities!: string[];
  @ApiProperty({ type: [String] }) @Transform(lines) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(400, { each: true }) requirements!: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @Transform(lines) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(400, { each: true }) niceToHave?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @Transform(lines) @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MaxLength(200, { each: true }) benefits?: string[];
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) salaryMin?: number | null;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) salaryMax?: number | null;
  @ApiPropertyOptional({ default: 'MAD' }) @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value)) @Matches(/^[A-Z]{3}$/) salaryCurrency?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showSalary?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() featured?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() urgent?: boolean;
  @ApiPropertyOptional({ enum: JOB_STATUSES, default: 'draft' }) @IsOptional() @IsIn(JOB_STATUSES) status?: (typeof JOB_STATUSES)[number];
}

export class AdminJobsQueryDto {
  @ApiPropertyOptional({ enum: JOB_STATUSES }) @IsOptional() @IsIn(JOB_STATUSES) status?: (typeof JOB_STATUSES)[number];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AdminApplicationsQueryDto {
  @ApiPropertyOptional({ description: 'Job id, or "general" for general applications.' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(40) jobId?: string;
  @ApiPropertyOptional({ enum: APPLICATION_STAGES }) @IsOptional() @IsIn(APPLICATION_STAGES) stage?: (typeof APPLICATION_STAGES)[number];
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(300) limit?: number;
}

export class UpdateApplicationDto {
  @ApiPropertyOptional({ enum: APPLICATION_STAGES }) @IsOptional() @IsIn(APPLICATION_STAGES) stage?: (typeof APPLICATION_STAGES)[number];
  @ApiPropertyOptional({ minimum: 1, maximum: 5, nullable: true }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number | null;
}

export class AddNoteDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 2000) body!: string;
}

export class SendCandidateEmailDto {
  @ApiProperty({ enum: CANDIDATE_EMAIL_TEMPLATES }) @IsIn(CANDIDATE_EMAIL_TEMPLATES) template!: (typeof CANDIDATE_EMAIL_TEMPLATES)[number];
  @ApiPropertyOptional({ description: 'Optional personal paragraph added to the template.' }) @IsOptional() @Transform(trim) @IsString() @MaxLength(1500) note?: string;
}

export class AnalyticsQueryDto {
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) days?: number;
}
