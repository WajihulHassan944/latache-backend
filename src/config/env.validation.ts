type Environment = Record<string, string | undefined>;

const SUPPORTED_ENVIRONMENTS = new Set([
  'local',
  'test',
  'development',
  'staging',
  'production',
]);
const DURATION_PATTERN = /^\d+[smhd]$/;
const BODY_LIMIT_PATTERN = /^\d+(?:b|kb|mb|gb)$/i;
const EMAIL_FROM_PATTERN = /^(?:[^<>]+\s*)?<[^<>\s]+@[^<>\s]+>$|^[^\s@]+@[^\s@]+$/;

const present = (value: string | undefined): boolean => Boolean(value?.trim());
const isProductionLike = (value: string): boolean =>
  value === 'production' || value === 'staging';

const validateInteger = (
  errors: string[],
  key: string,
  rawValue: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): void => {
  const value = Number.parseInt(rawValue ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors.push(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
};

const validateDuration = (
  errors: string[],
  key: string,
  rawValue: string | undefined,
  fallback: string,
): void => {
  if (!DURATION_PATTERN.test(rawValue ?? fallback)) {
    errors.push(`${key} must use a duration such as 15m, 2h, or 1d`);
  }
};

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const isPostgresUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
};

export const validateEnvironment = (environment: Environment): Environment => {
  const errors: string[] = [];
  const nodeEnvironment = environment.NODE_ENV ?? 'local';

  if (!SUPPORTED_ENVIRONMENTS.has(nodeEnvironment)) {
    errors.push(`NODE_ENV must be one of: ${[...SUPPORTED_ENVIRONMENTS].join(', ')}`);
  }

  validateInteger(errors, 'PORT', environment.PORT, 8080, 1, 65_535);
  validateInteger(errors, 'BCRYPT_ROUNDS', environment.BCRYPT_ROUNDS, 12, 10, 15);
  validateInteger(
    errors,
    'REFRESH_TOKEN_EXPIRES_IN_DAYS',
    environment.REFRESH_TOKEN_EXPIRES_IN_DAYS,
    30,
    1,
    365,
  );
  validateInteger(
    errors,
    'OTP_EXPIRES_IN_MINUTES',
    environment.OTP_EXPIRES_IN_MINUTES,
    5,
    1,
    60,
  );
  validateInteger(errors, 'SMTP_PORT', environment.SMTP_PORT, 587, 1, 65_535);
  validateInteger(
    errors,
    'SMTP_MAX_CONNECTIONS',
    environment.SMTP_MAX_CONNECTIONS,
    5,
    1,
    100,
  );
  validateInteger(
    errors,
    'SMTP_MAX_MESSAGES',
    environment.SMTP_MAX_MESSAGES,
    100,
    1,
    100_000,
  );
  validateDuration(errors, 'JWT_EXPIRES_IN', environment.JWT_EXPIRES_IN, '15m');
  validateDuration(
    errors,
    'PASS_JWT_EXPIRES_IN',
    environment.PASS_JWT_EXPIRES_IN,
    '15m',
  );

  if (!BODY_LIMIT_PATTERN.test(environment.REQUEST_BODY_LIMIT ?? '1mb')) {
    errors.push('REQUEST_BODY_LIMIT must use a value such as 512kb or 1mb');
  }

  if (nodeEnvironment !== 'test') {
    const required = [
      'DATABASE_URL',
      'JWT_SECRET',
      'JWT_SECRET_ADMIN',
      'PASSWORD_RESET_JWT_SECRET',
      'SMTP_HOST',
      'SMTP_FROM',
    ] as const;
    for (const key of required) {
      if (!present(environment[key])) errors.push(`${key} is required`);
    }
  }

  if (present(environment.DATABASE_URL) && !isPostgresUrl(environment.DATABASE_URL as string)) {
    errors.push('DATABASE_URL must be a valid PostgreSQL URL');
  }

  const smtpUserPresent = present(environment.SMTP_USER);
  const smtpPasswordPresent = present(environment.SMTP_PASSWORD);
  if (smtpUserPresent !== smtpPasswordPresent) {
    errors.push('SMTP_USER and SMTP_PASSWORD must either both be set or both be empty');
  }
  if (present(environment.SMTP_FROM) && !EMAIL_FROM_PATTERN.test(environment.SMTP_FROM as string)) {
    errors.push('SMTP_FROM must be an email address or a Name <email> mailbox');
  }

  for (const key of ['APP_BASE_URL', 'FRONTEND_BASE_URL'] as const) {
    const value = environment[key];
    if (present(value) && !isHttpUrl(value as string)) {
      errors.push(`${key} must be a valid http(s) URL`);
    }
  }

  if (present(environment.CORS_ORIGINS)) {
    for (const origin of (environment.CORS_ORIGINS as string).split(',')) {
      const normalized = origin.trim();
      if (!normalized || !isHttpUrl(normalized)) {
        errors.push(`CORS_ORIGINS contains an invalid origin: ${normalized || '<empty>'}`);
      }
    }
  }

  if (isProductionLike(nodeEnvironment)) {
    const secretKeys = [
      'JWT_SECRET',
      'JWT_SECRET_ADMIN',
      'PASSWORD_RESET_JWT_SECRET',
    ] as const;
    for (const key of secretKeys) {
      const value = environment[key];
      if (!value || value.length < 32) {
        errors.push(`${key} must contain at least 32 characters`);
      }
    }
    const secrets = secretKeys
      .map((key) => environment[key])
      .filter((value): value is string => Boolean(value));
    if (new Set(secrets).size !== secrets.length) {
      errors.push('JWT and password-reset secrets must be different values');
    }

    const insecureMarkers = [
      'replace-with-',
      'change-before-deployment',
      'placeholder',
      'example-secret',
    ];
    for (const key of secretKeys) {
      const normalized = environment[key]?.toLowerCase() ?? '';
      if (insecureMarkers.some((marker) => normalized.includes(marker))) {
        errors.push(`${key} contains an example or placeholder value`);
      }
    }

    if (!present(environment.FRONTEND_BASE_URL)) {
      errors.push('FRONTEND_BASE_URL is required in staging and production');
    }
    if ((environment.SMTP_FROM ?? '').toLowerCase().includes('@example.com')) {
      errors.push('SMTP_FROM must use a non-example sender domain');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }
  return environment;
};
