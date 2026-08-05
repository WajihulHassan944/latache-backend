import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_PATTERN,
} from '../../../common/constants/security.constants';

export class ResetPasswordDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain a letter, a number, and a special character',
  })
  password!: string;

  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  @Matches(PASSWORD_PATTERN, {
    message: 'conPassword must contain a letter, a number, and a special character',
  })
  conPassword!: string;

  @IsString()
  @Length(1, 4096)
  token!: string;
}
