import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { AdminRole } from '../../../common/enums/admin-role.enum';
import {
  ADMIN_PERMISSIONS,
  CREATABLE_ADMIN_ROLES,
} from '../constants/admin-permissions';
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

  @ApiProperty({ example: 'Temporary@12345', description: 'Temporary password; the admin must change it after login.' })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain a letter, a number, and a special character',
  })
  password!: string;

  @ApiProperty({
    enum: CREATABLE_ADMIN_ROLES,
    example: AdminRole.FinanceAdmin,
    description: 'The canonical super_admin role cannot be created through the API.',
  })
  @IsIn(CREATABLE_ADMIN_ROLES)
  adminRole!: AdminRole;

  @ApiPropertyOptional({
    type: [String],
    enum: ADMIN_PERMISSIONS,
    example: ['finance.read', 'reports.read'],
    description: 'Required only for custom_admin; ignored for predefined admin roles.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  permissions?: string[];
}
