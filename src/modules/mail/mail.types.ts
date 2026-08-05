import type { Transporter, TransportOptions } from 'nodemailer';

export interface MailTransporter {
  sendMail(options: {
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    text: string;
  }): Promise<unknown>;
  verify(): Promise<boolean>;
  close(): void;
}

export const asMailTransporter = <T, D extends TransportOptions>(
  transporter: Transporter<T, D>,
): MailTransporter => transporter as unknown as MailTransporter;
