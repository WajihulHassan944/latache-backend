import { ConfigService } from '@nestjs/config';
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
      if (key === 'auth.passwordResetExpiresIn') return '15m';
      if (key === 'mail.verifyOnBootstrap') return false;
      return fallback;
    }),
    getOrThrow: jest.fn().mockReturnValue('Latache <no-reply@example.com>'),
  } as unknown as ConfigService;
  const service = new MailService(transporter, config);

  beforeEach(() => jest.clearAllMocks());

  it('renders the OTP and escapes user-controlled content', () => {
    const html = service.renderVerificationTemplate({
      name: '<script>alert(1)</script>',
      otp: 1234,
      device: 'Chrome',
    });
    expect(html).toContain('1234');
    expect(html).toContain('expires in 5 minutes');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('awaits Nodemailer and maps SMTP errors to a service error', async () => {
    sendMail.mockRejectedValueOnce(new Error('rejected'));
    await expect(
      service.sendVerificationEmail({ to: 'a@example.com', name: 'A', otp: 1234 }),
    ).rejects.toThrow('Email delivery is temporarily unavailable');
  });
});
