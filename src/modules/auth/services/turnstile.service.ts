import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 5_000;

export type TurnstileAction = 'login' | 'signup' | 'forgot-password' | 'resend-verification';

interface TurnstileVerifyResponse {
  success: boolean;
  action?: string;
  hostname?: string;
  'error-codes'?: string[];
}

/**
 * Shared Cloudflare Turnstile verification for the public auth endpoints.
 * Callers must invoke this before any password comparison, lockout
 * bookkeeping, DB write, or email/OTP send - a failed or unavailable
 * captcha must not have any of those side effects, and must not reveal
 * whether an account exists.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  constructor(private readonly config: ConfigService) {}

  async verify(
    token: string | undefined,
    remoteIp: string | undefined,
    expectedAction: TurnstileAction,
  ): Promise<void> {
    if (!this.config.get<boolean>('turnstile.enabled', false)) return;

    if (!token) {
      throw new BadRequestException({
        code: 'CAPTCHA_FAILED',
        message: 'Captcha verification failed. Please try again.',
      });
    }

    const secret = this.config.get<string>('turnstile.secretKey');
    const params = new URLSearchParams({ secret: secret ?? '', response: token });
    if (remoteIp) params.set('remoteip', remoteIp);

    let result: TurnstileVerifyResponse;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
      const response = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!response.ok) throw new Error(`Turnstile siteverify responded with ${response.status}`);
      result = (await response.json()) as TurnstileVerifyResponse;
    } catch (error) {
      this.logger.warn(
        `Turnstile siteverify request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException({
        code: 'CAPTCHA_UNAVAILABLE',
        message: 'Captcha verification is temporarily unavailable. Please try again shortly.',
      });
    }

    const actionMatches = !result.action || result.action === expectedAction;
    if (!result.success || !actionMatches) {
      throw new BadRequestException({
        code: 'CAPTCHA_FAILED',
        message: 'Captcha verification failed. Please try again.',
      });
    }
  }
}
