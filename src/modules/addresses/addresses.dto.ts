import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AddressParamDto {
  @ApiProperty({ example: 'cm10abc123' })
  @Transform(trim)
  @IsString()
  @Length(1, 40)
  id!: string;
}

export class CreateAddressDto {
  @ApiProperty({ example: 'Home', minLength: 1, maxLength: 120, description: 'Short label, e.g. Home or Work.' })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  label!: string;

  @ApiProperty({
    example: '123 Rue Mohammed V, Casablanca',
    minLength: 1,
    maxLength: 500,
    description: 'Full human-readable address.',
  })
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  address!: string;

  @ApiProperty({ example: 33.5731, minimum: -90, maximum: 90 })
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({ example: -7.5898, minimum: -180, maximum: 180 })
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({
    default: false,
    description: 'Make this the default address. The first saved address is always made default regardless of this flag.',
  })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateAddressDto {
  @ApiPropertyOptional({ example: 'Home', minLength: 1, maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  label?: string;

  @ApiPropertyOptional({ example: '123 Rue Mohammed V, Casablanca', minLength: 1, maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 500)
  address?: string;

  @ApiPropertyOptional({ example: 33.5731, minimum: -90, maximum: 90 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: -7.5898, minimum: -180, maximum: 180 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({ description: 'Setting true unsets the customer previous default address.' })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
