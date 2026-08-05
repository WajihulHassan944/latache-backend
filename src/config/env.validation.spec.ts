import { validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  it('accepts a configured development environment', () => {
    const environment = {
      NODE_ENV: 'development',
      PORT: '8080',
      DATABASE_URL: 'postgresql://latache:latache@localhost:5432/latache',
      JWT_SECRET: 'development-jwt-secret',
      JWT_SECRET_ADMIN: 'development-admin-secret',
      PASSWORD_RESET_JWT_SECRET: 'development-reset-secret',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_FROM: 'Latache <no-reply@latache.local>',
    };
    expect(validateEnvironment(environment)).toEqual(environment);
  });

  it('accepts SMTP without credentials for a local relay', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://latache:latache@localhost:5432/latache',
        JWT_SECRET: 'development-jwt-secret',
        JWT_SECRET_ADMIN: 'development-admin-secret',
        PASSWORD_RESET_JWT_SECRET: 'development-reset-secret',
        SMTP_HOST: 'localhost',
        SMTP_FROM: 'no-reply@latache.local',
      }),
    ).not.toThrow();
  });

  it('rejects partial SMTP credentials', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        SMTP_USER: 'user',
      }),
    ).toThrow('SMTP_USER and SMTP_PASSWORD');
  });

  it('rejects weak production secrets and missing production services', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://latache:latache@localhost:5432/latache',
        JWT_SECRET: 'short',
      }),
    ).toThrow('Invalid environment configuration');
  });

  it('rejects unknown environments and invalid numeric limits', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'prod',
        DATABASE_URL: 'postgresql://latache:latache@localhost:5432/latache',
        BCRYPT_ROUNDS: '100',
      }),
    ).toThrow('NODE_ENV must be one of');
  });
});
