import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const PARTICIPANT_DISPUTE_STATUSES = [
  'all',
  'open',
  'under_investigation',
  'escalated',
  'resolved',
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
