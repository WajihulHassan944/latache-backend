import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
    return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(
      '.',
    );
  }

  decrypt(encrypted: string): Record<string, string> {
    const key = this.key();
    if (!key) {
      throw new ServiceUnavailableException({
        code: 'PAYOUT_ENCRYPTION_NOT_CONFIGURED',
        message:
          'Payout detail storage is disabled until PAYOUT_DATA_ENCRYPTION_KEY is configured.',
      });
    }
    const parts = encrypted.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new BadRequestException('Payout payload is not in a recognized encrypted format');
    }
    const [, ivPart, tagPart, dataPart] = parts as [string, string, string, string];
    try {
      const iv = Buffer.from(ivPart, 'base64');
      const tag = Buffer.from(tagPart, 'base64');
      const data = Buffer.from(dataPart, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8'));
    } catch {
      throw new BadRequestException('Payout payload could not be decrypted');
    }
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
