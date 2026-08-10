import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const COMPLAINT_CATEGORIES = [
  'unprofessional',
  'poor_quality',
  'missed_appointment',
  'overcharged',
  'misbehaved',
  'safety',
  'customer_conduct',
  'scope_change',
  'payment',
  'other',
] as const;

export class ComplaintAttachmentDto {
  @ApiProperty({ example: 'latache/booking-attachments/customer/42/abc123' })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  publicId!: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/demo/image/upload/example.webp' })
  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  secureUrl!: string;

  @ApiPropertyOptional({ example: 'image' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  resourceType?: string;

  @ApiPropertyOptional({ example: 'before-service.jpg' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  originalFileName?: string;

  @ApiPropertyOptional({ example: 2457600 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bytes?: number;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  mimeType?: string;
}

export class FileComplaintDto {
  @ApiProperty({
    enum: COMPLAINT_CATEGORIES,
    example: 'poor_quality',
    description:
      'Shared complaint categories for Customer and Tasker booking disputes.',
  })
  @IsIn(COMPLAINT_CATEGORIES)
  category!: (typeof COMPLAINT_CATEGORIES)[number];

  @ApiProperty({
    example: 'The work was materially different from the agreed task scope.',
  })
  @Transform(trim)
  @IsString()
  @Length(20, 5000)
  description!: string;

  @ApiPropertyOptional({ type: [ComplaintAttachmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => ComplaintAttachmentDto)
  attachments?: ComplaintAttachmentDto[];
}


export class ComplaintEvidenceDto {
  @ApiProperty({ example: 'Before-service photo' })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 'latache/booking-attachments/customer/42/abc123' })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  publicId!: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/demo/image/upload/example.webp' })
  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  secureUrl!: string;

  @ApiPropertyOptional({ example: 'image' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  resourceType?: string;

  @ApiPropertyOptional({ example: 2457600 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bytes?: number;

  @ApiPropertyOptional({ example: 'image/jpeg' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  mimeType?: string;
}

export class AddComplaintEvidenceDto {
  @ApiProperty({ type: [ComplaintEvidenceDto], maxItems: 10 })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ComplaintEvidenceDto)
  evidence!: ComplaintEvidenceDto[];
}
