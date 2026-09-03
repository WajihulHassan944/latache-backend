import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty({
    example: 'cleaning',
    minLength: 1,
    maxLength: 120,
    description: 'Service category slug, from GET /api/services.',
  })
  @IsString()
  @Length(1, 120)
  slug!: string;

  @ApiProperty({
    example: 15,
    description:
      'Hourly rate in the platform display currency; must fall within the service min/max hourly rate range.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000)
  hourlyRate!: number;
}

export class AvailabilitySlotDto {
  @ApiProperty({ example: '2026-09-10', description: 'Date in YYYY-MM-DD format.' })
  @IsDateOnly()
  date!: string;

  @ApiProperty({ example: '09:00', description: '24-hour or AM/PM time, e.g. 09:00 or 9:00 AM.' })
  @IsClockTime()
  startTime!: string;

  @ApiProperty({ example: '17:00', description: '24-hour or AM/PM time, e.g. 17:00 or 5:00 PM.' })
  @IsClockTime()
  endTime!: string;
}

export class IdentityDto {
  @ApiProperty({ enum: IdentityType, example: IdentityType.GovernmentId })
  @IsEnum(IdentityType)
  idType!: IdentityType;

  @ApiPropertyOptional({
    type: FileMetadataDto,
    description:
      'Metadata for the identity document already uploaded via POST /api/uploads/single or POST /api/uploads/single/signature.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => FileMetadataDto)
  document?: FileMetadataDto;
}

export class ServiceAreaDto {
  @ApiProperty({ example: 'Downtown Casablanca', minLength: 1, maxLength: 255 })
  @IsString()
  @Length(1, 255)
  label!: string;

  @ApiProperty({ example: 33.5731, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: -7.5898, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiProperty({
    example: 15,
    description: 'Service radius in kilometers around lat/lng.',
    maximum: 500,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(500)
  radiusKm!: number;

  @ApiPropertyOptional({ example: 'Casablanca', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @ApiPropertyOptional({ example: 'Maarif', maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  area?: string;
}

export class SubmitOnboardingDto {
  @ApiProperty({
    type: [TaskerServiceDto],
    description: 'At least one service with its hourly rate.',
    example: [
      { slug: 'cleaning', hourlyRate: 15 },
      { slug: 'gardening', hourlyRate: 20 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TaskerServiceDto)
  services!: TaskerServiceDto[];

  @ApiProperty({ example: 5, minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  yearsOfExperience!: number;

  @ApiProperty({
    example:
      'Experienced house cleaner with 5 years of experience serving Casablanca and nearby areas.',
    minLength: 1,
    maxLength: 5000,
  })
  @IsString()
  @Length(1, 5000)
  bio!: string;

  @ApiProperty({
    type: [AvailabilitySlotDto],
    description: 'At least one open availability slot.',
    example: [
      { date: '2026-09-10', startTime: '09:00', endTime: '17:00' },
      { date: '2026-09-11', startTime: '09:00', endTime: '17:00' },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AvailabilitySlotDto)
  availability!: AvailabilitySlotDto[];

  @ApiProperty({ type: IdentityDto })
  @ValidateNested()
  @Type(() => IdentityDto)
  identity!: IdentityDto;

  @ApiProperty({ type: ServiceAreaDto })
  @ValidateNested()
  @Type(() => ServiceAreaDto)
  serviceArea!: ServiceAreaDto;
}
