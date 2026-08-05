import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import { MAIL_TRANSPORTER } from './mail.constants';
import { MailService } from './mail.service';
import { asMailTransporter, type MailTransporter } from './mail.types';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: MAIL_TRANSPORTER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MailTransporter => {
        const user = config.get<string>('mail.user');
        const password = config.get<string>('mail.password');

        const transportOptions: SMTPTransport.Options = {
          host: config.get<string>('mail.host') ?? 'localhost',
          port: config.get<number>('mail.port', 587),
          secure: config.get<boolean>('mail.secure', false),
          auth: user && password ? { user, pass: password } : undefined,
          tls: {
            rejectUnauthorized: config.get<boolean>(
              'mail.tlsRejectUnauthorized',
              true,
            ),
          },
        };

        return asMailTransporter(
          nodemailer.createTransport(transportOptions),
        );
      },
    },
    MailService,
  ],
  exports: [MailService],
})
export class MailModule {}
