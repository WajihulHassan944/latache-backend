import { validateEnvironment } from './env.validation';

const valid = () => ({
  NODE_ENV: 'development',
  PORT: '8080',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/latache',
  JWT_SECRET: 'development-access-secret',
  JWT_SECRET_ADMIN: 'development-admin-secret',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  SMTP_FROM: 'Latache <no-reply@latache.local>',
  CLOUDINARY_CLOUD_NAME: 'latache-development',
  CLOUDINARY_API_KEY: '1234567890',
  CLOUDINARY_API_SECRET: 'development-cloudinary-secret',
});

describe('validateEnvironment', () => {
  it('accepts a valid development environment', () => {
    expect(validateEnvironment(valid())).toEqual(valid());
  });

  it('rejects invalid OTP durations and mismatched SMTP credentials', () => {
    expect(() =>
      validateEnvironment({
        ...valid(),
        PASSWORD_RESET_OTP_EXPIRES_IN_MINUTES: '0',
        SMTP_USER: 'user',
      }),
    ).toThrow(/PASSWORD_RESET_OTP_EXPIRES_IN_MINUTES/);
  });

  it('rejects unsafe SMTP timeout values', () => {
    expect(() =>
      validateEnvironment({
        ...valid(),
        SMTP_CONNECTION_TIMEOUT_MS: '0',
        SMTP_SOCKET_TIMEOUT_MS: '999999',
      }),
    ).toThrow(/SMTP_CONNECTION_TIMEOUT_MS/);
  });

  it('requires independent long secrets in production', () => {
    expect(() =>
      validateEnvironment({
        ...valid(),
        NODE_ENV: 'production',
        JWT_SECRET: 'same',
        JWT_SECRET_ADMIN: 'same',
      }),
    ).toThrow(/at least 32 characters/);
  });

  it('does not allow production to silently disable Redis-backed scheduled work', () => {
    expect(() =>
      validateEnvironment({
        ...valid(),
        NODE_ENV: 'production',
        JWT_SECRET: 'production-access-secret-1234567890',
        JWT_SECRET_ADMIN: 'production-admin-secret-12345678901',
        OTP_HASH_SECRET: 'production-otp-hash-secret-1234567890',
        CHAT_CALLS_ENABLED: 'false',
      }),
    ).toThrow(/automatic booking completion cannot be silently disabled/);
  });

  it('requires the default locale to be configured and supported', () => {
    expect(() =>
      validateEnvironment({
        ...valid(),
        SUPPORTED_LOCALES: 'en,ar,ary',
        DEFAULT_LOCALE: 'fr',
      }),
    ).toThrow(/DEFAULT_LOCALE/);
  });

  it('requires a valid Redis URL when queues are enabled', () => {
    expect(() =>
      validateEnvironment({
        ...valid(),
        REDIS_ENABLED: 'true',
        JOBS_ENABLED: 'true',
        REDIS_URL: 'https://not-redis.example',
      }),
    ).toThrow(/REDIS_URL/);
  });

  it('accepts MAIL_PROVIDER=brevo with a key and from address', () => {
    expect(
      validateEnvironment({
        ...valid(),
        MAIL_PROVIDER: 'brevo',
        BREVO_API_KEY: 'xkeysib-test',
        BREVO_FROM: 'Latache <no-reply@latache.local>',
      }),
    ).toMatchObject({ MAIL_PROVIDER: 'brevo' });
  });

  it('requires BREVO_API_KEY when MAIL_PROVIDER=brevo', () => {
    expect(() =>
      validateEnvironment({
        ...valid(),
        MAIL_PROVIDER: 'brevo',
      }),
    ).toThrow(/BREVO_API_KEY is required/);
  });

  it('requires BREVO_FROM or SMTP_FROM when MAIL_PROVIDER=brevo', () => {
    const withoutSmtpFrom: Record<string, string | undefined> = { ...valid() };
    withoutSmtpFrom.SMTP_FROM = undefined;
    expect(() =>
      validateEnvironment({
        ...withoutSmtpFrom,
        MAIL_PROVIDER: 'brevo',
        BREVO_API_KEY: 'xkeysib-test',
      }),
    ).toThrow(/BREVO_FROM or SMTP_FROM is required/);
  });

  it('rejects an unrecognized MAIL_PROVIDER', () => {
    expect(() =>
      validateEnvironment({
        ...valid(),
        MAIL_PROVIDER: 'mailgun',
      }),
    ).toThrow(/MAIL_PROVIDER must be one of smtp, resend, or brevo/);
  });
});
