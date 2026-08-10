import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

const normalizeCode = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    : value;

export class CreateRbacRoleDto {
  @ApiProperty({ example: 'Regional Operations Administrator' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiPropertyOptional({
    example: 'regional_operations_admin',
    description: 'Stable lower_snake_case code. When omitted it is generated from name.',
  })
  @IsOptional()
  @Transform(normalizeCode)
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{2,63}$/)
  code?: string;

  @ApiPropertyOptional({ example: 'Manages tasker and booking operations for a region.' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({
    type: [String],
    example: ['taskers.read', 'taskers.manage', 'bookings.read'],
    description: 'Permission keys must exist in GET /api/rbac/permissions.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissions!: string[];
}
