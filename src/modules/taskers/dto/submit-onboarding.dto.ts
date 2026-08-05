import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IdentityType } from '../../../common/enums/identity-type.enum';
import { IsClockTime } from '../../../common/validators/is-clock-time.validator';
import { IsDateOnly } from '../../../common/validators/is-date-only.validator';
import { FileMetadataDto } from './file-metadata.dto';

export class TaskerServiceDto {
  @IsString()
  @Length(1, 120)
  slug!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000)
  hourlyRate!: number;
}

export class AvailabilitySlotDto {
  @IsDateOnly()
  date!: string;

  @IsClockTime()
  startTime!: string;

  @IsClockTime()
  endTime!: string;
}

export class IdentityDto {
  @IsEnum(IdentityType)
  idType!: IdentityType;

  @IsOptional()
  @ValidateNested()
  @Type(() => FileMetadataDto)
  document?: FileMetadataDto;
}

export class ServiceAreaDto {
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

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(500)
  radiusKm!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  area?: string;
}

export class SubmitOnboardingDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaskerServiceDto)
  services!: TaskerServiceDto[];

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  yearsOfExperience!: number;

  @IsString()
  @Length(1, 5000)
  bio!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability!: AvailabilitySlotDto[];

  @ValidateNested()
  @Type(() => IdentityDto)
  identity!: IdentityDto;

  @ValidateNested()
  @Type(() => ServiceAreaDto)
  serviceArea!: ServiceAreaDto;
}
