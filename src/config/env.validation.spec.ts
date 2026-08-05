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
});
