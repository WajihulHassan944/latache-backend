import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  Max,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsClockTime } from '../../../common/validators/is-clock-time.validator';
import { IsDateOnly } from '../../../common/validators/is-date-only.validator';
import { FileMetadataDto } from '../../taskers/dto/file-metadata.dto';

export class BookingLocationDto {
  @IsString()
  @Length(1, 255)
  label!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  area?: string;
}

export class BookingDetailsDto {
  @IsString()
  @Length(1, 500)
  venueAddress!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  apartmentSuite?: string;

  @IsString()
  @Length(1, 5000)
  description!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileMetadataDto)
  attachments?: FileMetadataDto[];
}

export class BookTaskerDto {
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

  @IsOptional()
  @IsIn(['stripe', 'wallet'])
  paymentSource?: 'stripe' | 'wallet';

  @IsOptional()
  @IsString()
  @Length(3, 255)
  stripePaymentMethodId?: string;

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

  @IsOptional()
  @IsBoolean()
  donationDropoffRequested?: boolean;

  @ValidateNested()
  @Type(() => BookingLocationDto)
  location!: BookingLocationDto;

  @IsDateOnly()
  date!: string;

  @IsClockTime()
  time!: string;

  @ValidateNested()
  @Type(() => BookingDetailsDto)
  bookingDetails!: BookingDetailsDto;
}
