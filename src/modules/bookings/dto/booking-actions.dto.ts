import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsClockTime } from '../../../common/validators/is-clock-time.validator';
import { IsDateOnly } from '../../../common/validators/is-date-only.validator';

export class BookingParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId!: number;
}

export class ListUnifiedBookingsQueryDto {
  @ApiPropertyOptional({ enum: ['booked', 'ongoing', 'history'], default: 'booked' })
  @IsOptional()
  @IsIn(['booked', 'ongoing', 'history'])
  bucket?: 'booked' | 'ongoing' | 'history';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CancelBookingDto {
  @ApiProperty({ example: 'My schedule changed.' })
  @IsString()
  @Length(3, 1000)
  reason!: string;
}

export class RescheduleBookingDto {
  @ApiProperty({ example: '2026-08-14' })
  @IsDateOnly()
  date!: string;

  @ApiProperty({ example: '14:00' })
  @IsClockTime()
  time!: string;
}

export class ExtendBookingDto {
  @ApiProperty({
    example: 30,
    minimum: 1,
    maximum: 240,
    description:
      'Additional minutes. From the customer they are added immediately; from the Tasker they ' +
      'create a pending request that adds nothing until the customer approves it.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  minutes!: number;

  @ApiPropertyOptional({ example: 'The cabinet needs one more coat.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}

export class ExtensionRequestParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bookingId!: number;

  @ApiProperty({ example: 'cm123abc456def' })
  @IsString()
  @Length(1, 40)
  requestId!: string;
}

export class RespondExtensionRequestDto {
  @ApiProperty({ example: true, description: 'true adds the requested minutes; false declines them.' })
  @IsBoolean()
  approve!: boolean;
}

export class UpdateBookingBillingDto {
  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  tipAmount?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  donationAmount?: number;

  @ApiPropertyOptional({
    example: true,
    description: 'Whether the customer requested a donation drop-off as part of this booking.',
  })
  @IsOptional()
  @IsBoolean()
  donationDropoffRequested?: boolean;
}

export class BookingQuoteDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  taskerId!: number;

  @IsString()
  @Length(1, 120)
  serviceSlug!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceOptionId?: number;

  @IsDateOnly()
  date!: string;

  @IsClockTime()
  time!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  tipAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  donationAmount?: number;

  @ApiPropertyOptional({
    description:
      'Id of an accepted custom-time request for this exact tasker/service/date/time. Skips the open-slot match; requires the requesting customer\'s bearer token.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  customTimeRequestId?: string;

  @ApiPropertyOptional({
    description:
      'Same as POST /bookings: inferred by default (no open listed slot at this time = custom time); ' +
      'false requires an open listed slot.',
  })
  @IsOptional()
  @IsBoolean()
  customTime?: boolean;
}
