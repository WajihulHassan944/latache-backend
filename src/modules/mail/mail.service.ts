import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MAIL_TRANSPORTER } from './mail.constants';
import type { MailTransporter } from './mail.types';
import {
  adminWelcomeTemplate,
  emailPlainText,
  emailSubject,
  passwordResetOtpTemplate,
  verificationEmailTemplate,
} from './email-templates';
import { latacheEmailAttachments, type LatacheEmailAttachment } from './email-layout';

@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);

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
    locale?: string;
  }): Promise<void> {
    const expiryMinutes = this.config.get<number>('auth.otpExpiresInMinutes', 5);
    await this.send({
      to: params.to,
      subject: emailSubject('verification', params.locale),
      html: verificationEmailTemplate({ ...params, expiryMinutes }),
      text: emailPlainText('verification', {
        locale: params.locale,
        otp: params.otp,
        expiryMinutes,
      }),
    });
  }

  async sendPasswordResetOtp(params: {
    to: string;
    name: string;
    otp: number;
    locale?: string;
  }): Promise<void> {
    const expiryMinutes = this.config.get<number>('auth.passwordResetOtpExpiresInMinutes', 15);
    await this.send({
      to: params.to,
      subject: emailSubject('password-reset', params.locale),
      html: passwordResetOtpTemplate({ ...params, expiryMinutes }),
      text: emailPlainText('password-reset', {
        locale: params.locale,
        otp: params.otp,
        expiryMinutes,
      }),
    });
  }

  async sendAdminWelcomeEmail(params: {
    to: string;
    name: string;
    temporaryPassword: string;
    adminRole: string;
    locale?: string;
  }): Promise<void> {
    await this.send({
      to: params.to,
      subject: emailSubject('admin-welcome', params.locale),
      html: adminWelcomeTemplate({
        name: params.name,
        email: params.to,
        temporaryPassword: params.temporaryPassword,
        adminRole: params.adminRole,
        locale: params.locale,
      }),
      text: emailPlainText('admin-welcome', {
        locale: params.locale,
        email: params.to,
        temporaryPassword: params.temporaryPassword,
      }),
    });
  }

  private async send(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
    attachments?: LatacheEmailAttachment[];
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.config.getOrThrow<string>('mail.from'),
        attachments: params.attachments ?? latacheEmailAttachments(),
        ...params,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`SMTP delivery failed: ${message}`);
      throw new ServiceUnavailableException('Email delivery is temporarily unavailable');
    }
  }
}
