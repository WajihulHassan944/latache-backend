import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsString, Length, Matches, Min } from 'class-validator';
import { IsDateOnly } from '../../../common/validators/is-date-only.validator';

export class CustomTimeRequestTaskerParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskerId!: number;
}

export class CustomTimeRequestParamDto {
  @IsString()
  @Length(1, 40)
  requestId!: string;
}

export class CreateCustomTimeRequestDto {
  @ApiProperty({ example: 'cleaning', description: 'An active Service the Tasker offers.' })
  @IsString()
  @Length(1, 120)
  serviceSlug!: string;

  @ApiProperty({ example: '2026-09-30', description: 'YYYY-MM-DD, today or later.' })
  @IsDateOnly()
  requestedDate!: string;

  @ApiProperty({ example: '19:30', description: '24-hour HH:mm.' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'requestedTime must be HH:mm (24-hour)' })
  requestedTime!: string;
}

export class RespondCustomTimeRequestDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  accept!: boolean;
}
