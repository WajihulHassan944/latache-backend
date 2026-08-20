import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const PARTICIPANT_DISPUTE_STATUSES = [
  'all',
  'open',
  'under_investigation',
  'escalated',
  'resolved',
  'dismissed',
  'withdrawn',
] as const;

export class ListParticipantDisputesQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId?: number;

  @ApiPropertyOptional({ enum: PARTICIPANT_DISPUTE_STATUSES, default: 'all' })
  @IsOptional()
  @IsIn(PARTICIPANT_DISPUTE_STATUSES)
  status?: (typeof PARTICIPANT_DISPUTE_STATUSES)[number] = 'all';

  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 100, default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 30;
}

export class ParticipantDisputeParamDto {
  @ApiProperty({ example: 'cm123abc456def' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  disputeId!: string;
}

export const PARTICIPANT_DISPUTE_ACTIONS = [
  'withdraw',
  'accept_proposal',
  'reject_proposal',
  'appeal',
  'comment',
] as const;

export class ParticipantDisputeActionDto {
  @ApiProperty({ enum: PARTICIPANT_DISPUTE_ACTIONS })
  @IsIn(PARTICIPANT_DISPUTE_ACTIONS)
  action!: (typeof PARTICIPANT_DISPUTE_ACTIONS)[number];

  @ApiPropertyOptional({ example: 'cm123resolution' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  resolutionId?: string;

  @ApiPropertyOptional({ example: 'I do not agree with the proposed settlement because…' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  message?: string;
}

export class SubmitDisputeSatisfactionDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiPropertyOptional({ example: 'The dispute was handled fairly and quickly.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
