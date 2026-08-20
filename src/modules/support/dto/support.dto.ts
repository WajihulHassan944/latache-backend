import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CloudinaryAssetRefDto } from '../../tasker-dashboard/dto/tasker-dashboard.dto';
import {
  SUPPORT_ADMIN_VIEWS,
  SUPPORT_CATEGORIES,
  SUPPORT_CHANNELS,
  SUPPORT_PRIORITIES,
  SUPPORT_STATUSES,
} from '../support.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreateSupportTicketDto {
  @ApiPropertyOptional({
    example: '01JSUPPORT9A4R7X2K6M8Q5T3V1',
    description:
      'Stable client-generated request ID. Retrying the same ticket creation returns the original ticket.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(8, 80)
  clientRequestId?: string;

  @ApiPropertyOptional({ enum: SUPPORT_CHANNELS, default: 'ticket' })
  @IsOptional()
  @IsIn(SUPPORT_CHANNELS)
  channel?: 'ticket' | 'live_chat';

  @ApiProperty({ example: 'Unable to cancel booking' })
  @Transform(trim)
  @IsString()
  @Length(3, 200)
  subject!: string;

  @ApiProperty({ enum: SUPPORT_CATEGORIES, example: 'booking' })
  @IsIn(SUPPORT_CATEGORIES)
  category!: (typeof SUPPORT_CATEGORIES)[number];

  @ApiPropertyOptional({ enum: SUPPORT_PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES)
  priority?: (typeof SUPPORT_PRIORITIES)[number];

  @ApiProperty({
    example: 'I tried to cancel my upcoming booking but the app returned an error.',
  })
  @Transform(trim)
  @IsString()
  @Length(3, 5000)
  description!: string;

  @ApiPropertyOptional({ example: 1842 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId?: number;

  @ApiPropertyOptional({
    enum: ['payment_transaction', 'tasker_withdrawal'],
    description:
      'Optional verified reference. The backend validates that the referenced record belongs to the authenticated user.',
  })
  @IsOptional()
  @IsIn(['payment_transaction', 'tasker_withdrawal'])
  referenceType?: 'payment_transaction' | 'tasker_withdrawal';

  @ApiPropertyOptional({ example: 'cm5payment123' })
  @ValidateIf((dto: CreateSupportTicketDto) => dto.referenceType !== undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  referenceId?: string;

  @ApiPropertyOptional({ type: [CloudinaryAssetRefDto], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CloudinaryAssetRefDto)
  attachments?: CloudinaryAssetRefDto[];
}

export class ListOwnSupportTicketsQueryDto {
  @ApiPropertyOptional({ enum: SUPPORT_CHANNELS })
  @IsOptional()
  @IsIn(SUPPORT_CHANNELS)
  channel?: 'ticket' | 'live_chat';

  @ApiPropertyOptional({ enum: SUPPORT_STATUSES })
  @IsOptional()
  @IsIn(SUPPORT_STATUSES)
  status?: (typeof SUPPORT_STATUSES)[number];

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SupportTicketParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id!: number;
}

export class SendSupportMessageDto {
  @ApiPropertyOptional({
    example: '01JSUPPORTMSG7X2K6M8Q5T3V1Z0',
    description:
      'Stable client-generated ID used to make message retries idempotent. Reuse with different content returns 409.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(8, 80)
  clientMessageId?: string;

  @ApiPropertyOptional({ example: 'Here is the booking reference and a screenshot.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  body?: string;

  @ApiPropertyOptional({ type: [CloudinaryAssetRefDto], maxItems: 5 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => CloudinaryAssetRefDto)
  attachments?: CloudinaryAssetRefDto[];
}

export class ListSupportMessagesQueryDto {
  @ApiPropertyOptional({
    example: 'cm5supportmessage123',
    description:
      'Message ID returned as nextCursor. Cursor mode takes precedence over page and is recommended.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  cursor?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class MarkSupportReadDto {
  @ApiPropertyOptional({
    example: 'cm5supportmessage123',
    description:
      'Marks eligible inbound messages through this visible message. Omit to mark all current eligible messages.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  throughMessageId?: string;
}

export class SupportTicketUserActionDto {
  @ApiProperty({ enum: ['close', 'reopen'] })
  @IsIn(['close', 'reopen'])
  action!: 'close' | 'reopen';
}

export class SupportFeedbackDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;

  @ApiPropertyOptional({ example: 'The agent resolved the issue quickly.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 1000)
  comment?: string;
}

export class AdminSupportQueryDto {
  @ApiPropertyOptional({ enum: SUPPORT_ADMIN_VIEWS, default: 'support_tickets' })
  @IsOptional()
  @IsIn(SUPPORT_ADMIN_VIEWS)
  view?: (typeof SUPPORT_ADMIN_VIEWS)[number];

  @ApiPropertyOptional({ enum: SUPPORT_STATUSES })
  @IsOptional()
  @IsIn(SUPPORT_STATUSES)
  status?: (typeof SUPPORT_STATUSES)[number];

  @ApiPropertyOptional({ enum: SUPPORT_PRIORITIES })
  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES)
  priority?: (typeof SUPPORT_PRIORITIES)[number];

  @ApiPropertyOptional({ enum: SUPPORT_CATEGORIES })
  @IsOptional()
  @IsIn(SUPPORT_CATEGORIES)
  category?: (typeof SUPPORT_CATEGORIES)[number];

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignedAdminId?: number;

  @ApiPropertyOptional({ example: 'refund' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  search?: string;

  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 30, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ enum: ['json', 'csv'], default: 'json' })
  @IsOptional()
  @IsIn(['json', 'csv'])
  format?: 'json' | 'csv';
}

export class AdminSupportActionDto {
  @ApiProperty({
    enum: [
      'assign',
      'unassign',
      'start',
      'wait',
      'set_priority',
      'escalate',
      'resolve',
      'close',
      'reopen',
    ],
  })
  @IsIn([
    'assign',
    'unassign',
    'start',
    'wait',
    'set_priority',
    'escalate',
    'resolve',
    'close',
    'reopen',
  ])
  action!:
    | 'assign'
    | 'unassign'
    | 'start'
    | 'wait'
    | 'set_priority'
    | 'escalate'
    | 'resolve'
    | 'close'
    | 'reopen';

  @ApiPropertyOptional({ example: 14 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assignedAdminId?: number;

  @ApiPropertyOptional({ enum: SUPPORT_PRIORITIES })
  @IsOptional()
  @IsIn(SUPPORT_PRIORITIES)
  priority?: (typeof SUPPORT_PRIORITIES)[number];

  @ApiPropertyOptional({ example: 'Payment issue requires finance follow-up.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 1000)
  reason?: string;

  @ApiPropertyOptional({
    example: 'The account state was corrected and the customer confirmed access.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 5000)
  resolutionSummary?: string;
}

export class AdminSendSupportMessageDto extends SendSupportMessageDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Internal notes are visible only to authorized support administrators.',
  })
  @IsOptional()
  @IsBoolean()
  internalNote?: boolean;
}
