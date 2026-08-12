import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_PATTERN,
} from '../../../common/constants/security.constants';
import { normalizeEmail, trim } from './common-auth.dto';

export class CreateAdminDto {
  @ApiProperty({ example: 'Priya' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  firstName!: string;

  @ApiProperty({ example: 'Nair' })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  lastName!: string;

  @ApiProperty({ example: 'priya@latache.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ example: '+212' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+[1-9]\d{0,3}$/)
  phoneCountryCode?: string;

  @ApiPropertyOptional({ example: '612345678' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{6,24}$/)
  phoneNumber?: string;

  @ApiProperty({
    example: 'Temporary@12345',
    description: 'Temporary password; the administrator must change it after login.',
  })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain a letter, a number, and a special character',
  })
  password!: string;

  @ApiProperty({
    example: 'finance_admin',
    description:
      'Active role code returned by GET /api/rbac/roles. The canonical super_admin role cannot be assigned through this endpoint.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{2,63}$/)
  adminRole!: string;

  @ApiPropertyOptional({
    type: [String],
    example: ['finance.read', 'reports.read'],
    description:
      'Optional least-privilege subset of the selected role. Omit to inherit the role permission set and future role updates.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissions?: string[];

  @ApiPropertyOptional({
    enum: ['en', 'ar', 'ary'],
    default: 'en',
    description: 'ary is Moroccan Darija.',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase().replace('_', '-') : value,
  )
  @IsString()
  @Matches(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
  preferredLanguage?: string;
}
