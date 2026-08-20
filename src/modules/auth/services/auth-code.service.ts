import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

type AuthCodePurpose = 'email-verification' | 'password-reset';

@Injectable()
export class AuthCodeService {
  private readonly secret: string;

  constructor(config: ConfigService) {
    this.secret = config.getOrThrow<string>('auth.otpHashSecret');
  }

  hash(purpose: AuthCodePurpose, code: string | number): string {
    return createHmac('sha256', this.secret)
      .update(`${purpose}:${String(code)}`, 'utf8')
      .digest('hex');
  }

  matches(purpose: AuthCodePurpose, code: string | number, expectedHash: string | null): boolean {
    if (!expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
    const actual = Buffer.from(this.hash(purpose, code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
