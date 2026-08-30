import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SOCIAL_AUTH_PROVIDER, type SocialAuthProvider } from '../social-auth.constants';
import { OidcJwtVerifierService, type OidcJwtPayload } from './oidc-jwt-verifier.service';

export interface VerifiedSocialIdentity {
  provider: SocialAuthProvider;
  subject: string;
  email: string;
  emailVerified: boolean;
  emailAuthoritative: boolean;
  firstName: string | null;
  lastName: string | null;
  picture: string | null;
  isPrivateEmail: boolean;
  clientId: string;
}

@Injectable()
export class SocialAuthProviderService {
  constructor(
    private readonly config: ConfigService,
    private readonly verifier: OidcJwtVerifierService,
  ) {}

  verify(provider: SocialAuthProvider, idToken: string, nonce?: string): Promise<VerifiedSocialIdentity> {
    return provider === SOCIAL_AUTH_PROVIDER.Google
      ? this.verifyGoogle(idToken, nonce)
      : this.verifyApple(idToken, nonce);
  }

  private async verifyGoogle(idToken: string, nonce?: string): Promise<VerifiedSocialIdentity> {
    const audiences = this.clientIds('socialAuth.googleClientIds', 'GOOGLE_AUTH_CLIENT_IDS');
    const payload = await this.verifier.verifyRs256({
      token: idToken,
      jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
      issuers: ['https://accounts.google.com', 'accounts.google.com'],
      audiences,
      nonce,
      fallbackCacheSeconds: this.config.get<number>('socialAuth.jwksCacheSeconds', 3600),
      clockSkewSeconds: this.config.get<number>('socialAuth.clockSkewSeconds', 60),
    });
    const subject = this.requiredString(payload, 'sub');
    const email = this.requiredString(payload, 'email').trim().toLowerCase();
    if (!this.booleanClaim(payload.email_verified)) {
      throw new UnauthorizedException('Google email is not verified');
    }
    const clientId = this.audience(payload);
    const hd = this.optionalString(payload, 'hd');
    return {
      provider: SOCIAL_AUTH_PROVIDER.Google,
      subject,
      email,
      emailVerified: true,
      emailAuthoritative: email.endsWith('@gmail.com') || Boolean(hd),
      firstName: this.optionalString(payload, 'given_name'),
      lastName: this.optionalString(payload, 'family_name'),
      picture: this.optionalString(payload, 'picture'),
      isPrivateEmail: false,
      clientId,
    };
  }

  private async verifyApple(idToken: string, nonce?: string): Promise<VerifiedSocialIdentity> {
    const audiences = this.clientIds('socialAuth.appleClientIds', 'APPLE_AUTH_CLIENT_IDS');
    const payload = await this.verifier.verifyRs256({
      token: idToken,
      jwksUrl: 'https://appleid.apple.com/auth/keys',
      issuers: ['https://appleid.apple.com'],
      audiences,
      nonce,
      fallbackCacheSeconds: this.config.get<number>('socialAuth.jwksCacheSeconds', 3600),
      clockSkewSeconds: this.config.get<number>('socialAuth.clockSkewSeconds', 60),
    });
    const subject = this.requiredString(payload, 'sub');
    const email = this.requiredString(payload, 'email').trim().toLowerCase();
    if (!this.booleanClaim(payload.email_verified)) {
      throw new UnauthorizedException('Apple email is not verified');
    }
    return {
      provider: SOCIAL_AUTH_PROVIDER.Apple,
      subject,
      email,
      emailVerified: true,
      emailAuthoritative: true,
      firstName: null,
      lastName: null,
      picture: null,
      isPrivateEmail: this.booleanClaim(payload.is_private_email),
      clientId: this.audience(payload),
    };
  }

  private clientIds(configKey: string, envName: string): string[] {
    const values = this.config.get<string[]>(configKey, []);
    if (values.length === 0) {
      throw new ServiceUnavailableException({
        code: 'SOCIAL_AUTH_NOT_CONFIGURED',
        message: `${envName} is not configured on the backend.`,
      });
    }
    return values;
  }

  private audience(payload: OidcJwtPayload): string {
    if (typeof payload.aud === 'string') return payload.aud;
    if (Array.isArray(payload.aud)) {
      if (payload.aud.length > 1 && typeof payload.azp === 'string' && payload.azp.trim()) {
        return payload.azp.trim();
      }
      const value = payload.aud.find((item) => typeof item === 'string');
      if (typeof value === 'string') return value;
    }
    throw new UnauthorizedException('Invalid social identity token audience');
  }

  private requiredString(payload: OidcJwtPayload, key: string): string {
    const value = this.optionalString(payload, key);
    if (!value) throw new UnauthorizedException('Invalid social identity token');
    return value;
  }

  private optionalString(payload: OidcJwtPayload, key: string): string | null {
    return typeof payload[key] === 'string' && (payload[key] as string).trim()
      ? (payload[key] as string).trim()
      : null;
  }

  private booleanClaim(value: unknown): boolean {
    return value === true || value === 'true';
  }
}
