import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AdminPaginationDto } from './admin-pagination.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const ADMIN_DISPUTE_VIEWS = [
  'open',
  'under_investigation',
  'escalated',
  'resolved',
  'evidence_review',
  'resolution_actions',
  'all',
] as const;

export const DISPUTE_PRIORITIES = ['normal', 'high', 'urgent'] as const;

export class AdminDisputesQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({ enum: ADMIN_DISPUTE_VIEWS, default: 'open' })
  @IsOptional()
  @IsIn(ADMIN_DISPUTE_VIEWS)
  view?: (typeof ADMIN_DISPUTE_VIEWS)[number] = 'open';

  @ApiPropertyOptional({ example: 'DSP-ABC123, B-4811, incomplete work, Mike' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(160)
  search?: string;

  @ApiPropertyOptional({ enum: ['all', ...DISPUTE_PRIORITIES], default: 'all' })
  @IsOptional()
  @IsIn(['all', ...DISPUTE_PRIORITIES])
  priority?: 'all' | (typeof DISPUTE_PRIORITIES)[number] = 'all';

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    description: 'Filter cases assigned to a specific administrator.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignedAdminId?: number;

  @ApiPropertyOptional({
    example: '2026-08-01',
    description: 'Complaint creation date, inclusive. Supply with to.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({
    example: '2026-08-31',
    description: 'Complaint creation date, inclusive. Supply with from.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ enum: ['newest', 'oldest', 'priority', 'amount_desc'], default: 'newest' })
  @IsOptional()
  @IsIn(['newest', 'oldest', 'priority', 'amount_desc'])
  sort?: 'newest' | 'oldest' | 'priority' | 'amount_desc' = 'newest';
}

export class AdminDisputeEvidenceDto {
  @ApiProperty({ example: 'Before_cleaning_photo.jpg' })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  name!: string;

  @ApiProperty({ example: 'latache/booking-attachments/admin/42/abc' })
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

export const DISPUTE_RESOLUTION_TYPES = [
  'full_refund',
  'partial_refund',
  'warning',
  'full_refund_and_warning',
  'partial_refund_and_warning',
  'no_refund',
  'dismiss',
] as const;

export const ADMIN_DISPUTE_ACTIONS = [
  'start_investigation',
  'assign',
  'set_priority',
  'escalate',
  'request_evidence',
  'add_evidence',
  'review_evidence',
  'save_resolution_draft',
  'propose_resolution',
  'resolve',
  'confirm_cash_refund',
  'reopen',
] as const;

export class AdminDisputeActionDto {
  @ApiProperty({ enum: ADMIN_DISPUTE_ACTIONS })
  @IsIn(ADMIN_DISPUTE_ACTIONS)
  action!: (typeof ADMIN_DISPUTE_ACTIONS)[number];

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    description: 'Used by assign/start_investigation.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignedAdminId?: number;

  @ApiPropertyOptional({ enum: DISPUTE_PRIORITIES })
  @IsOptional()
  @IsIn(DISPUTE_PRIORITIES)
  priority?: (typeof DISPUTE_PRIORITIES)[number];

  @ApiPropertyOptional({
    example: 'Escalated because the allegation concerns safety and requires senior review.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  reason?: string;

  @ApiPropertyOptional({
    enum: ['customer', 'tasker', 'both'],
    description: 'Used by request_evidence.',
  })
  @IsOptional()
  @IsIn(['customer', 'tasker', 'both'])
  requestedFrom?: 'customer' | 'tasker' | 'both';

  @ApiPropertyOptional({ example: 'Please provide photos and the final invoice for this booking.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  message?: string;

  @ApiPropertyOptional({
    example: '2026-08-12',
    description: 'UTC due date for requested evidence.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string;

  @ApiPropertyOptional({ type: [AdminDisputeEvidenceDto], maxItems: 10 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => AdminDisputeEvidenceDto)
  evidence?: AdminDisputeEvidenceDto[];

  @ApiPropertyOptional({ example: 'The uploaded before/after photos are internally consistent.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  reviewNotes?: string;

  @ApiPropertyOptional({
    example: 'cm123resolution',
    description: 'Update/apply a previously saved draft resolution.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  resolutionId?: string;

  @ApiPropertyOptional({ enum: DISPUTE_RESOLUTION_TYPES })
  @IsOptional()
  @IsIn(DISPUTE_RESOLUTION_TYPES)
  resolutionType?: (typeof DISPUTE_RESOLUTION_TYPES)[number];

  @ApiPropertyOptional({
    example: 60,
    minimum: 0.01,
    description: 'Required only for partial refund actions.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999)
  refundAmount?: number;

  @ApiPropertyOptional({
    enum: ['customer', 'tasker', 'both'],
    description: 'Required for warning outcomes.',
  })
  @IsOptional()
  @IsIn(['customer', 'tasker', 'both'])
  warningTarget?: 'customer' | 'tasker' | 'both';

  @ApiPropertyOptional({
    default: true,
    description: 'Retained for backward compatibility. Participant lifecycle notifications for applied dispute outcomes are mandatory and cannot be suppressed.',
  })
  @IsOptional()
  @IsBoolean()
  notifyParties?: boolean = true;


  @ApiPropertyOptional({
    example: '2026-08-21',
    description: 'UTC response deadline used by propose_resolution.',
  })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  proposalResponseDueDate?: string;

  @ApiPropertyOptional({
    example: 'BANK-TRANSFER-20260818-001',
    description: 'Real manual transfer/bank reference used by confirm_cash_refund.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  manualTransferReference?: string;

  @ApiPropertyOptional({
    example: 'Transfer verified against bank statement by finance administrator.',
    description: 'Auditable confirmation notes used by confirm_cash_refund.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  confirmationNotes?: string;

  @ApiPropertyOptional({
    example:
      'Partial refund approved after evidence review; remaining amount is payable to the Tasker.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(5)
  @MaxLength(5000)
  resolutionSummary?: string;
}
