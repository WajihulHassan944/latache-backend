import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { IsPhoneMatchingCountryCode } from '../../../common/validators/is-phone-matching-country-code.validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class AdminCustomerProfileUpdateDto {
  @ApiPropertyOptional({ example: 'Sarah', minLength: 1, maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Ahmed', minLength: 1, maxLength: 60 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 60)
  lastName?: string;

  @ApiPropertyOptional({ example: 'sarah@example.com' })
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ example: '+212', description: 'International dialing prefix.' })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\+[1-9]\d{0,3}$/, {
    message: 'phoneCountryCode must be a valid international dialing prefix',
  })
  phoneCountryCode?: string;

  @ApiPropertyOptional({ example: '612345678', maxLength: 24 })
  @IsOptional()
  @Transform(trim)
  @Matches(/^\d{6,24}$/, { message: 'phoneNumber must contain 6 to 24 digits' })
  @IsPhoneMatchingCountryCode()
  phoneNumber?: string;
}
