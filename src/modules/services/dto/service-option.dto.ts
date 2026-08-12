import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ArrayMaxSize,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TranslationDto } from '../../localization/translation.dto';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class ServiceOptionTranslationDto extends TranslationDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  declare description?: string;
}

export class ServiceIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  serviceId!: number;
}

export class ServiceOptionParamDto extends ServiceIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  optionId!: number;
}

export class CreateServiceOptionDto {
  @ApiProperty({ example: 'Deep Cleaning' })
  @Transform(trim)
  @IsString()
  @Length(2, 255)
  name!: string;

  @ApiProperty({ example: 'deep-cleaning' })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @ApiPropertyOptional({ example: 'A more intensive version of the service.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  description?: string;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [ServiceOptionTranslationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ServiceOptionTranslationDto)
  translations?: ServiceOptionTranslationDto[];
}

export class UpdateServiceOptionDto {
  @ApiPropertyOptional({ example: 'Deep Cleaning' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 255)
  name?: string;

  @ApiPropertyOptional({ example: 'A more intensive version of the service.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  description?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: 0, minimum: 0, maximum: 10000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;

  @ApiPropertyOptional({ type: [ServiceOptionTranslationDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ServiceOptionTranslationDto)
  translations?: ServiceOptionTranslationDto[];
}
