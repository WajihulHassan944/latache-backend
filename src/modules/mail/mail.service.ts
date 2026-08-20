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
import type { MailRecipientAddress, MailTransporter } from './mail.types';
import {
  adminWelcomeTemplate,
  disputeLifecycleEmailTemplate,
  emailPlainText,
  emailSubject,
  passwordResetOtpTemplate,
  verificationEmailTemplate,
} from './email-templates';

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

  async sendDisputeLifecycleEmail(params: {
    to: string;
    name: string;
    disputeId: string;
    eventType: string;
    detail: string;
    locale?: string;
  }): Promise<void> {
    const rendered = disputeLifecycleEmailTemplate(params);
    await this.send({
      to: params.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  private async send(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    try {
      const delivery = await this.transporter.sendMail({
        from: this.config.getOrThrow<string>('mail.from'),
        ...params,
      });
      const requestedRecipient = this.normalizeRecipient(params.to);
      const acceptedRecipients = delivery.accepted.map((recipient) =>
        this.normalizeRecipient(recipient),
      );
      if (!acceptedRecipients.includes(requestedRecipient)) {
        throw new Error('SMTP_RECIPIENT_NOT_ACCEPTED');
      }

      const responseCode = /^\d{3}/.exec(delivery.response ?? '')?.[0] ?? 'unknown';
      this.logger.log(
        JSON.stringify({
          event: 'smtp_delivery_accepted',
          recipientDomain: requestedRecipient.split('@')[1] ?? 'unknown',
          messageId: delivery.messageId || 'unknown',
          responseCode,
        }),
      );
    } catch (error) {
      const message = this.safeErrorMessage(error);
      this.logger.error(`SMTP delivery failed: ${message}`);
      throw new ServiceUnavailableException('Email delivery is temporarily unavailable');
    }
  }

  private normalizeRecipient(recipient: string | MailRecipientAddress): string {
    return (typeof recipient === 'string' ? recipient : recipient.address).trim().toLowerCase();
  }

  private safeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w.-]+\.[A-Za-z]{2,}/g, '<redacted-email>');
  }
}
