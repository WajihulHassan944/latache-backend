import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const CONTACT_TOPICS = ['customer', 'tasker', 'company', 'press', 'privacy', 'other'] as const;
export const CONTACT_STATUSES = ['new', 'open', 'waiting', 'resolved', 'spam'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SubmitEnquiryDto {
  @ApiProperty({ example: 'Fatima Ait Ben' }) @Transform(trim) @IsString() @Length(2, 160) fullName!: string;
  @ApiProperty() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)) @IsEmail() @MaxLength(255) email!: string;
  @ApiPropertyOptional({ example: '+212612345678' }) @IsOptional() @Transform(trim) @Matches(/^\+?[0-9 ()-]{7,24}$/, { message: 'Enter a valid phone number' }) phone?: string;
  @ApiProperty({ enum: CONTACT_TOPICS }) @IsIn(CONTACT_TOPICS) topic!: (typeof CONTACT_TOPICS)[number];
  @ApiProperty({ minLength: 10, maxLength: 3000 }) @Transform(trim) @IsString() @Length(10, 3000) message!: string;
  @ApiProperty({ description: 'Must be true - consent to be contacted about this message.' }) @IsBoolean() consent!: boolean;
  /** Honeypot: real users never see or fill it. */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) website?: string;
  @ApiPropertyOptional({ description: 'Cloudflare Turnstile token (required when Turnstile is enabled).' }) @IsOptional() @IsString() @MaxLength(4096) captchaToken?: string;
}

export class EnquiriesQueryDto {
  @ApiPropertyOptional({ enum: CONTACT_STATUSES }) @IsOptional() @IsIn(CONTACT_STATUSES) status?: (typeof CONTACT_STATUSES)[number];
  @ApiPropertyOptional({ enum: CONTACT_TOPICS }) @IsOptional() @IsIn(CONTACT_TOPICS) topic?: (typeof CONTACT_TOPICS)[number];
  @ApiPropertyOptional({ description: '"me", "unassigned" or an admin id' }) @IsOptional() @IsString() @MaxLength(20) assignee?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) search?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class UpdateEnquiryDto {
  @ApiPropertyOptional({ enum: CONTACT_STATUSES }) @IsOptional() @IsIn(CONTACT_STATUSES) status?: (typeof CONTACT_STATUSES)[number];
  @ApiPropertyOptional({ nullable: true, description: 'Admin user id, or null to unassign' }) @IsOptional() @Type(() => Number) @IsInt() assignedAdminId?: number | null;
}

export class MessageBodyDto {
  @ApiProperty({ maxLength: 5000 }) @Transform(trim) @IsString() @Length(1, 5000) body!: string;
}
