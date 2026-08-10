import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, randomBytes } from 'node:crypto';

@Injectable()
export class PayoutDataSecurityService {
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return this.key() !== null;
  }

  encrypt(payload: Record<string, string>): string {
    const key = this.key();
    if (!key) {
      throw new ServiceUnavailableException({
        code: 'PAYOUT_ENCRYPTION_NOT_CONFIGURED',
        message:
          'Payout detail storage is disabled until PAYOUT_DATA_ENCRYPTION_KEY is configured.',
      });
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
  }

  private key(): Buffer | null {
    const raw = this.config.get<string>('taskerPayout.encryptionKey')?.trim();
    if (!raw) return null;
    if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    try {
      const decoded = Buffer.from(raw, 'base64');
      return decoded.length === 32 ? decoded : null;
    } catch {
      return null;
    }
  }
}
