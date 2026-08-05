import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BaseRegistrationDto, trim } from './common-auth.dto';

export class TaskerAvailabilityDto {
  @ApiProperty({ example: '2026-08-12', description: 'Calendar date in YYYY-MM-DD format.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must use YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ example: '09:00', description: '24-hour time in HH:mm format.' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'startTime must use HH:mm' })
  startTime!: string;

  @ApiProperty({ example: '17:00', description: '24-hour time in HH:mm format.' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'endTime must use HH:mm' })
  endTime!: string;
}

export class TaskerIdentityDocumentsDto {
  @ApiProperty({ example: 'passport', description: 'Government-issued identity document type.' })
  @Transform(trim)
  @IsString()
  @Length(2, 64)
  governmentIdType!: string;

  @ApiProperty({ example: 'https://cdn.example.com/documents/passport.pdf' })
  @Transform(trim)
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  governmentIdUrl!: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/documents/electricity-bill.pdf' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  electricityBillUrl?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/documents/residency-permit.pdf' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  residencyPermitUrl?: string;
}

export class TaskerServiceAreaDto {
  @ApiProperty({ example: 'Sugar Hill, Georgia' })
  @Transform(trim)
  @IsString()
  @Length(2, 255)
  label!: string;

  @ApiProperty({ example: 34.1065 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @ApiProperty({ example: -84.0335 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @ApiProperty({ example: 15, description: 'Coverage radius in kilometers.' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  radiusKm!: number;

  @ApiPropertyOptional({ example: 'Sugar Hill' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  city?: string;

  @ApiPropertyOptional({ example: 'Gwinnett County' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  area?: string;
}

export class RegisterTaskerDto extends BaseRegistrationDto {
  @ApiProperty({
    example: [1, 2, 6],
    description: 'Exactly three service IDs selected during the expertise step.',
  })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  serviceIds!: number[];

  @ApiProperty({ example: 2, minimum: 0, maximum: 60 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  yearsOfExperience!: number;

  @ApiProperty({
    example: 'I am a reliable professional with two years of experience delivering high-quality work.',
    minLength: 20,
    maxLength: 2000,
  })
  @Transform(trim)
  @IsString()
  @Length(20, 2000)
  aboutMe!: string;

  @ApiProperty({ example: 35, description: 'Hourly rate applied to the selected services.' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  @Max(10000)
  hourlyRate!: number;

  @ApiProperty({ type: [TaskerAvailabilityDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(90)
  @ValidateNested({ each: true })
  @Type(() => TaskerAvailabilityDto)
  availability!: TaskerAvailabilityDto[];

  @ApiProperty({ type: TaskerIdentityDocumentsDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TaskerIdentityDocumentsDto)
  identityDocuments!: TaskerIdentityDocumentsDto;

  @ApiProperty({ type: TaskerServiceAreaDto })
  @IsObject()
  @ValidateNested()
  @Type(() => TaskerServiceAreaDto)
  serviceArea!: TaskerServiceAreaDto;
}
