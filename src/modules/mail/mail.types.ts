import type { Transporter, TransportOptions } from 'nodemailer';

export interface MailRecipientAddress {
  address: string;
  name?: string;
}

export interface MailDeliveryResult {
  messageId: string;
  accepted: Array<string | MailRecipientAddress>;
  rejected: Array<string | MailRecipientAddress>;
  pending?: Array<string | MailRecipientAddress>;
  response?: string;
}

export interface MailTransporter {
  sendMail(options: {
    from: string;
    to: string | string[];
    subject: string;
    html: string;
    text: string;
  }): Promise<MailDeliveryResult>;
  verify(): Promise<boolean>;
  close(): void;
}

export const asMailTransporter = <T, D extends TransportOptions>(
  transporter: Transporter<T, D>,
): MailTransporter => transporter as unknown as MailTransporter;
