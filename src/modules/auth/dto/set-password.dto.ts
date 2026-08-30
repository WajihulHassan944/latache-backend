import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_PATTERN,
} from '../../../common/constants/security.constants';
import {
  SOCIAL_AUTH_PROVIDERS,
  type SocialAuthProvider,
} from '../social-auth.constants';

export class SetPasswordDto {
  @ApiProperty({
    example: 'LocalPassword@123',
    description: 'Creates a local password for an authenticated social-only Latache identity.',
  })
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain a letter, a number, and a special character',
  })
  password!: string;

  @ApiProperty({
    enum: SOCIAL_AUTH_PROVIDERS,
    description:
      'An already-linked provider used to reauthenticate the account before adding a persistent local credential.',
  })
  @IsIn(SOCIAL_AUTH_PROVIDERS)
  provider!: SocialAuthProvider;

  @ApiProperty({
    description:
      'Fresh provider-issued ID token for the already-linked Google/Apple identity. This step-up check prevents a stolen Latache session from silently adding a local password.',
  })
  @IsString()
  @Length(20, 16384)
  idToken!: string;

  @ApiPropertyOptional({ description: 'Expected provider nonce claim when one was requested.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  nonce?: string;
}
