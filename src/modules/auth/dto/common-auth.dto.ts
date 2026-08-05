import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
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

export const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export const normalizeEmail = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class BaseRegistrationDto {
  @ApiProperty({ example: 'Sarah', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  firstName!: string;

  @ApiProperty({ example: 'Ahmed', minLength: 2, maxLength: 100 })
  @Transform(trim)
  @IsString()
  @Length(2, 100)
  lastName!: string;

  @ApiProperty({ example: 'sarah@example.com' })
  @Transform(normalizeEmail)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: '+212', description: 'International dialing prefix.' })
  @Transform(trim)
  @IsString()
  @Matches(/^\+[1-9]\d{0,3}$/, {
    message: 'phoneCountryCode must be a valid international dialing prefix',
  })
  phoneCountryCode!: string;

  @ApiProperty({ example: '612345678', maxLength: 24 })
  @Transform(trim)
  @IsString()
  @Matches(/^\d{6,24}$/, { message: 'phoneNumber must contain 6 to 24 digits' })
  phoneNumber!: string;

  @ApiProperty({ example: 'StrongPassword@123', minLength: MIN_PASSWORD_LENGTH })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain a letter, a number, and a special character',
  })
  password!: string;

  @ApiProperty({ example: '10001', minLength: 3, maxLength: 16 })
  @Transform(trim)
  @IsString()
  @Length(3, 16)
  zipCode!: string;

  @ApiProperty({
    example: true,
    description:
      'Required consent from the single Latache signup checkbox covering the Terms and Conditions and Privacy Policy.',
  })
  @IsBoolean()
  @Equals(true, { message: 'acceptedTermsAndPrivacyPolicy must be true' })
  acceptedTermsAndPrivacyPolicy!: true;

  @ApiPropertyOptional({
    example: 'Chrome on Windows',
    maxLength: 255,
    description: 'Optional human-readable device label used for session management.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  device?: string;
}
