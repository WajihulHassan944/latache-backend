import type { SentMessageInfo, Transporter } from 'nodemailer';

export interface MailTransporter {
  sendMail(options: {
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    text: string;
  }): Promise<SentMessageInfo>;
  verify(): Promise<boolean>;
  close(): void;
}

export const asMailTransporter = (transporter: Transporter): MailTransporter => transporter;
