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
  }): Promise<void> {
    const expiryMinutes = this.config.get<number>('auth.otpExpiresInMinutes', 5);
    await this.send({
      to: params.to,
      subject: 'Verify your Latache email',
      html: verificationEmailTemplate({ ...params, expiryMinutes }),
      text: `Your Latache verification code is ${params.otp}. It expires in ${expiryMinutes} minutes.`,
    });
  }

  async sendPasswordResetOtp(params: {
    to: string;
    name: string;
    otp: number;
  }): Promise<void> {
    const expiryMinutes = this.config.get<number>(
      'auth.passwordResetOtpExpiresInMinutes',
      15,
    );
    await this.send({
      to: params.to,
      subject: 'Reset your Latache password',
      html: passwordResetOtpTemplate({ ...params, expiryMinutes }),
      text: `Your Latache password reset code is ${params.otp}. It expires in ${expiryMinutes} minutes.`,
    });
  }

  async sendAdminWelcomeEmail(params: {
    to: string;
    name: string;
    temporaryPassword: string;
    adminRole: string;
  }): Promise<void> {
    await this.send({
      to: params.to,
      subject: 'Your Latache administrator account',
      html: adminWelcomeTemplate({
        name: params.name,
        email: params.to,
        temporaryPassword: params.temporaryPassword,
        adminRole: params.adminRole,
      }),
      text: `Your Latache administrator account is ready. Email: ${params.to}. Temporary password: ${params.temporaryPassword}. Change it after login.`,
    });
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
