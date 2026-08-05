import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_PATTERN,
} from '../../../common/constants/security.constants';
import { UserRole } from '../../../common/enums/user-role.enum';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class SignUpDto {
  @Transform(trim)
  @IsString()
  @Length(3, 100)
  firstName!: string;

  @Transform(trim)
  @IsString()
  @Length(3, 100)
  lastName!: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(32)
  authType!: string;

  @ValidateIf((dto: SignUpDto) => dto.authType === '')
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain a letter, a number, and a special character',
  })
  password!: string;

  @IsIn([UserRole.Customer, UserRole.Tasker], {
    message: 'role must be customer or tasker',
  })
  role!: UserRole;

  @Transform(trim)
  @IsString()
  @Length(5, 32)
  zipCode!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(32)
  phoneNumber?: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  device?: string;
}
