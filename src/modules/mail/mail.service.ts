import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from '../../common/utils/html.util';
import { MAIL_TRANSPORTER } from './mail.constants';
import type { MailTransporter } from './mail.types';

type TemplateName = 'verification.html' | 'password-reset.html';

@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private readonly templates = new Map<TemplateName, string>();

  constructor(
    @Inject(MAIL_TRANSPORTER) private readonly transporter: MailTransporter,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get<boolean>('mail.verifyOnBootstrap', false)) return;
    try {
      await this.transporter.verify();
      this.logger.log('SMTP transport verified');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SMTP verification failed: ${message}`);
      throw new Error('SMTP configuration could not be verified');
    }
  }

  onModuleDestroy(): void {
    this.transporter.close();
  }

  async sendVerificationEmail(params: {
    to: string;
    name: string;
    otp: number;
    device?: string;
  }): Promise<void> {
    const expiryMinutes = this.config.get<number>('auth.otpExpiresInMinutes', 5);
    await this.send({
      to: params.to,
      subject: 'Verify your Latache email',
      html: this.renderVerificationTemplate(params),
      text: `Your Latache verification code is ${params.otp}. It expires in ${expiryMinutes} minutes.`,
    });
  }

  async sendPasswordResetEmail(params: {
    to: string;
    name: string;
    resetUrl: string;
  }): Promise<void> {
    await this.send({
      to: params.to,
      subject: 'Reset your Latache password',
      html: this.renderPasswordResetTemplate(params),
      text: `Reset your Latache password using this link: ${params.resetUrl}`,
    });
  }

  renderVerificationTemplate(params: {
    name: string;
    otp: number;
    device?: string;
  }): string {
    return this.renderTemplate('verification.html', {
      name: params.name || 'there',
      device: params.device || 'your device',
      otp: String(params.otp),
      expiryMinutes: String(this.config.get<number>('auth.otpExpiresInMinutes', 5)),
    });
  }

  renderPasswordResetTemplate(params: {
    name: string;
    resetUrl: string;
  }): string {
    return this.renderTemplate('password-reset.html', {
      name: params.name || 'there',
      resetUrl: params.resetUrl,
      expiryMinutes: String(this.passwordResetExpiryMinutes()),
    });
  }

  private renderTemplate(
    templateName: TemplateName,
    substitutions: Record<string, string>,
  ): string {
    const cachedTemplate = this.templates.get(templateName);
    const html =
      cachedTemplate ?? readFileSync(join(__dirname, 'templates', templateName), 'utf8');

    if (!cachedTemplate) {
      this.templates.set(templateName, html);
    }

    return Object.entries(substitutions).reduce(
      (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, escapeHtml(value)),
      html,
    );
  }

  private passwordResetExpiryMinutes(): number {
    const raw = this.config.get<string>('auth.passwordResetExpiresIn', '15m');
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match) return 15;
    const amount = Number(match[1]);
    const multiplier: Record<string, number> = { s: 1 / 60, m: 1, h: 60, d: 1_440 };
    return Math.max(1, Math.ceil(amount * (multiplier[match[2] ?? 'm'] ?? 1)));
  }

  private async send(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.getOrThrow<string>('mail.from'),
        ...params,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SMTP delivery failed: ${message}`);
      throw new ServiceUnavailableException('Email delivery is temporarily unavailable');
    }
  }
}
