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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  CONVERSATION_ATTACHMENT_MAX_FILES,
  CONVERSATION_ATTACHMENT_MAX_FILE_SIZE_BYTES,
  CONVERSATION_ATTACHMENT_MIME_TYPES,
} from '../uploads/conversation-attachment.constants';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ListConversationsQueryDto {
  @ApiPropertyOptional({ example: 'Marcus' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

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

export class ListMessagesQueryDto {
  @ApiPropertyOptional({
    description:
      'Message ID returned as nextCursor. Cursor mode takes precedence over page and is recommended for long conversations.',
    example: 'cm5message123',
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

export class ConversationAttachmentDto {
  @ApiProperty({
    example: 'latache/conversation-attachments/customer/42/abc123.pdf',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  publicId!: string;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/raw/upload/abc123.pdf',
  })
  @Transform(trim)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2048)
  secureUrl!: string;

  @ApiProperty({ enum: ['image', 'raw'], example: 'raw' })
  @IsIn(['image', 'raw'])
  resourceType!: 'image' | 'raw';

  @ApiProperty({ example: 245760, maximum: CONVERSATION_ATTACHMENT_MAX_FILE_SIZE_BYTES })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CONVERSATION_ATTACHMENT_MAX_FILE_SIZE_BYTES)
  bytes!: number;

  @ApiProperty({ example: 'scope-of-work.pdf' })
  @Transform(trim)
  @IsString()
  @Length(1, 255)
  originalFileName!: string;

  @ApiProperty({ enum: CONVERSATION_ATTACHMENT_MIME_TYPES, example: 'application/pdf' })
  @IsIn(CONVERSATION_ATTACHMENT_MIME_TYPES)
  mimeType!: (typeof CONVERSATION_ATTACHMENT_MIME_TYPES)[number];

  @ApiPropertyOptional({ example: 'pdf' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  format?: string;
}

export class SendMessageDto {
  @ApiPropertyOptional({
    example: '01JCHAT9A4R7X2K6M8Q5T3V1Z0',
    description:
      'Stable client-generated ID used to make retries idempotent. Reusing it with different content returns 409.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(8, 80)
  clientMessageId?: string;

  @ApiPropertyOptional({
    example: 'I attached the updated scope of work. Please confirm receipt.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(5000)
  body?: string;

  @ApiPropertyOptional({
    type: [ConversationAttachmentDto],
    maxItems: CONVERSATION_ATTACHMENT_MAX_FILES,
    description:
      'Upload files first with /api/uploads/single or /api/uploads/multiple using folder=conversation-attachments, then send the returned references here.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CONVERSATION_ATTACHMENT_MAX_FILES)
  @ValidateNested({ each: true })
  @Type(() => ConversationAttachmentDto)
  attachments?: ConversationAttachmentDto[];
}

export class MarkConversationReadDto {
  @ApiPropertyOptional({
    example: 'cm5message123',
    description:
      'Marks inbound messages only through this visible message. Omit to mark every current inbound message as read.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  throughMessageId?: string;
}

export class BookingConversationParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId!: number;
}

export class ConversationCallParamDto extends BookingConversationParamDto {
  @Transform(trim)
  @IsString()
  @Length(1, 80)
  callId!: string;
}

export class ListConversationCallsQueryDto {
  @ApiPropertyOptional({ enum: ['voice', 'video'] })
  @IsOptional()
  @IsIn(['voice', 'video'])
  type?: 'voice' | 'video';

  @ApiPropertyOptional({
    enum: ['ringing', 'accepted', 'rejected', 'cancelled', 'missed', 'ended'],
  })
  @IsOptional()
  @IsIn(['ringing', 'accepted', 'rejected', 'cancelled', 'missed', 'ended'])
  status?: 'ringing' | 'accepted' | 'rejected' | 'cancelled' | 'missed' | 'ended';

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
