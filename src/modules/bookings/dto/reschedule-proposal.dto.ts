import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsClockTime } from '../../../common/validators/is-clock-time.validator';
import { IsDateOnly } from '../../../common/validators/is-date-only.validator';

export class CreateRescheduleProposalDto {
  @ApiProperty({ example: '2026-08-14' })
  @IsDateOnly()
  date!: string;

  @ApiProperty({ example: '14:00' })
  @IsClockTime()
  time!: string;

  @ApiPropertyOptional({ example: 'Running long on the previous job, hoping this works instead.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RescheduleProposalParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId!: number;

  @ApiProperty({ example: 'cm123abc456def' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  proposalId!: string;
}

export class RespondRescheduleProposalDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  accept!: boolean;
}
