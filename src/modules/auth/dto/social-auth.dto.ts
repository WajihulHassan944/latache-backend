import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { UserRole } from '../../../common/enums/user-role.enum';
import { SOCIAL_AUTH_PROVIDERS, type SocialAuthProvider } from '../social-auth.constants';
import { trim } from './common-auth.dto';

const marketplaceRoles = [UserRole.Customer, UserRole.Tasker] as const;

export class SocialAuthDto {
  @ApiProperty({
    description: 'Provider-issued OpenID Connect ID token obtained by the frontend/native SDK.',
  })
  @IsString()
  @Length(20, 16384)
  idToken!: string;

  @ApiPropertyOptional({
    enum: marketplaceRoles,
    description:
      'Marketplace role to activate. New social identities are created with Customer access first; Tasker onboarding uses POST /auth/roles/tasker.',
  })
  @IsOptional()
  @IsIn(marketplaceRoles)
  role?: UserRole.Customer | UserRole.Tasker;

  @ApiPropertyOptional({
    example: true,
    description:
      'Required only when social authentication creates a new Latache identity or enables Customer access on an existing Tasker-only identity.',
  })
  @IsOptional()
  @IsBoolean()
  acceptedTermsAndPrivacyPolicy?: boolean;

  @ApiPropertyOptional({
    example: 'Sarah',
    description:
      'Optional profile name fallback. Apple only returns name on the first authorization, so the client should send it when available.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Ahmed' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(1, 100)
  lastName?: string;

  @ApiPropertyOptional({ example: '+212' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\+[1-9]\d{0,3}$/, {
    message: 'phoneCountryCode must be a valid international dialing prefix',
  })
  phoneCountryCode?: string;

  @ApiPropertyOptional({ example: '612345678' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^\d{6,24}$/, { message: 'phoneNumber must contain 6 to 24 digits' })
  phoneNumber?: string;

  @ApiPropertyOptional({ example: '10001' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 16)
  zipCode?: string;

  @ApiPropertyOptional({
    example: 'en',
    enum: ['en', 'ar', 'ary'],
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase().replace('_', '-') : value,
  )
  @IsString()
  @Matches(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
  preferredLanguage?: string;

  @ApiPropertyOptional({
    description:
      'Expected nonce claim when the client requested one. Send the exact nonce value represented in the ID token.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  nonce?: string;

  @ApiPropertyOptional({ example: 'iPhone 16 Pro' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  device?: string;
}

export class LinkSocialAuthDto {
  @ApiProperty({
    description: 'Provider-issued OpenID Connect ID token for the provider account being linked.',
  })
  @IsString()
  @Length(20, 16384)
  idToken!: string;

  @ApiPropertyOptional({
    description: 'Expected nonce claim when the client requested one.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  nonce?: string;

  @ApiPropertyOptional({
    description:
      'Step-up option for accounts that already have a local password. Supply the current Latache password before attaching a new provider.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  currentPassword?: string;

  @ApiPropertyOptional({
    enum: SOCIAL_AUTH_PROVIDERS,
    description:
      'Step-up option for social-only identities: an already-linked provider used to prove the current Latache identity before attaching another provider.',
  })
  @IsOptional()
  @IsIn(SOCIAL_AUTH_PROVIDERS)
  reauthProvider?: SocialAuthProvider;

  @ApiPropertyOptional({
    description: 'Fresh ID token from reauthProvider. Required together with reauthProvider.',
  })
  @IsOptional()
  @IsString()
  @Length(20, 16384)
  reauthIdToken?: string;

  @ApiPropertyOptional({ description: 'Expected nonce claim for the step-up provider token.' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reauthNonce?: string;
}
