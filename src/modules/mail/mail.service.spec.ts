import { ConfigService } from '@nestjs/config';
import { passwordResetOtpTemplate, verificationEmailTemplate } from './email-templates';
import { LATACHE_EMAIL_LOGO_URL } from './email-layout';
import { MailService } from './mail.service';
import type { MailTransporter } from './mail.types';

describe('MailService', () => {
  const sendMail = jest.fn().mockResolvedValue({ messageId: 'email-1' });
  const transporter: MailTransporter = {
    sendMail,
    verify: jest.fn().mockResolvedValue(true),
    close: jest.fn(),
  };
  const config = {
    get: jest.fn().mockImplementation((key: string, fallback: unknown) => {
      if (key === 'auth.otpExpiresInMinutes') return 5;
      if (key === 'auth.passwordResetOtpExpiresInMinutes') return 15;
      if (key === 'mail.verifyOnBootstrap') return false;
      return fallback;
    }),
    getOrThrow: jest.fn().mockReturnValue('Latache <no-reply@example.com>'),
  } as unknown as ConfigService;
  const service = new MailService(transporter, config);

  beforeEach(() => jest.clearAllMocks());

  it('renders verification values and escapes user-controlled HTML', () => {
    const html = verificationEmailTemplate({
      name: '<script>alert(1)</script>',
      otp: 123456,
      expiryMinutes: 5,
      device: 'Chrome',
    });
    expect(html).toContain('123456');
    expect(html).toContain('expires in 5 minutes');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('renders an OTP-only password reset email', () => {
    const html = passwordResetOtpTemplate({
      name: 'Sarah',
      otp: 334018,
      expiryMinutes: 15,
    });
    expect(html).toContain('334018');
    expect(html).toContain('expires in 15 minutes');
    expect(html).not.toContain('reset?token=');
    expect(html).not.toContain('Open reset page');
  });

  it('renders Arabic security email without standalone templates', () => {
    const html = verificationEmailTemplate({
      name: 'سارة',
      otp: 123456,
      expiryMinutes: 5,
      locale: 'ar',
    });
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain('تأكيد بريدك الإلكتروني');
    expect(html).toContain('123456');
  });

  it('renders Darija with RTL direction and the shared branded shell', () => {
    const html = verificationEmailTemplate({
      name: 'حسام',
      otp: 838463,
      expiryMinutes: 5,
      locale: 'ary-MA',
    });
    expect(html).toContain('lang="ary" dir="rtl"');
    expect(html).toContain('أكّد الإيميل ديالك');
    expect(html).toContain('data-latache-email-shell="v1"');
    expect(html).toContain(LATACHE_EMAIL_LOGO_URL);
  });

  it('CID-attaches every generated design asset to delivered mail', async () => {
    await service.sendVerificationEmail({
      to: 'a@example.com',
      name: 'A',
      otp: 123456,
      locale: 'en',
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const options = sendMail.mock.calls[0]?.[0] as {
      attachments?: Array<{ cid: string; path: string }>;
    };
    expect(options.attachments).toHaveLength(3);
    expect(options.attachments?.map((attachment) => attachment.cid)).toEqual([
      'latache-email-header@latache',
      'latache-security-shield@latache',
      'latache-email-footer@latache',
    ]);
    expect(options.attachments?.every((attachment) => attachment.path.endsWith('.png'))).toBe(true);
  });

  it('awaits Nodemailer and maps SMTP errors to a service error', async () => {
    sendMail.mockRejectedValueOnce(new Error('rejected'));
    await expect(
      service.sendVerificationEmail({ to: 'a@example.com', name: 'A', otp: 123456 }),
    ).rejects.toThrow('Email delivery is temporarily unavailable');
  });
});
