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
const PAYOUT_EXECUTION_MODES = new Set(['disabled', 'manual']);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

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
  validateInteger(
    errors,
    'PASSWORD_RESET_OTP_EXPIRES_IN_MINUTES',
    environment.PASSWORD_RESET_OTP_EXPIRES_IN_MINUTES,
    15,
    1,
    120,
  );
  validateInteger(errors, 'SMTP_PORT', environment.SMTP_PORT, 587, 1, 65_535);
  validateInteger(
    errors,
    'DB_TRANSACTION_MAX_WAIT_MS',
    environment.DB_TRANSACTION_MAX_WAIT_MS,
    15_000,
    1_000,
    120_000,
  );
  validateInteger(
    errors,
    'DB_TRANSACTION_TIMEOUT_MS',
    environment.DB_TRANSACTION_TIMEOUT_MS,
    30_000,
    5_000,
    120_000,
  );
  validateInteger(
    errors,
    'CLOUDINARY_MAX_FILE_SIZE_BYTES',
    environment.CLOUDINARY_MAX_FILE_SIZE_BYTES,
    10 * 1024 * 1024,
    1024,
    100 * 1024 * 1024,
  );
  validateDuration(errors, 'JWT_EXPIRES_IN', environment.JWT_EXPIRES_IN, '15m');

  const stripeEnabled = (environment.STRIPE_ENABLED ?? 'false').toLowerCase() === 'true';
  const paymentsCurrency = (environment.PAYMENTS_CURRENCY ?? 'USD').toUpperCase();
  if (!CURRENCY_PATTERN.test(paymentsCurrency)) {
    errors.push('PAYMENTS_CURRENCY must be a three-letter ISO-style currency code');
  }
  const platformFeePercent = Number(environment.PAYMENTS_PLATFORM_FEE_PERCENT ?? '0');
  if (!Number.isFinite(platformFeePercent) || platformFeePercent < 0 || platformFeePercent > 100) {
    errors.push('PAYMENTS_PLATFORM_FEE_PERCENT must be between 0 and 100');
  }
  validateInteger(
    errors,
    'BOOKING_MINIMUM_BILLABLE_MINUTES',
    environment.BOOKING_MINIMUM_BILLABLE_MINUTES,
    120,
    1,
    1440,
  );
  const minimumWalletTopup = Number(environment.CUSTOMER_WALLET_MIN_TOPUP ?? '5');
  if (!Number.isFinite(minimumWalletTopup) || minimumWalletTopup <= 0) {
    errors.push('CUSTOMER_WALLET_MIN_TOPUP must be a positive number');
  }
  if (stripeEnabled) {
    if (!present(environment.STRIPE_SECRET_KEY)) errors.push('STRIPE_SECRET_KEY is required when STRIPE_ENABLED=true');
    if (!present(environment.STRIPE_WEBHOOK_SECRET)) errors.push('STRIPE_WEBHOOK_SECRET is required when STRIPE_ENABLED=true');
    if (present(environment.STRIPE_SECRET_KEY) && !(environment.STRIPE_SECRET_KEY as string).startsWith('sk_')) {
      errors.push('STRIPE_SECRET_KEY must be a Stripe secret key');
    }
    if (present(environment.STRIPE_WEBHOOK_SECRET) && !(environment.STRIPE_WEBHOOK_SECRET as string).startsWith('whsec_')) {
      errors.push('STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret');
    }
  }

  const payoutMode = environment.TASKER_PAYOUT_EXECUTION_MODE ?? 'disabled';
  if (!PAYOUT_EXECUTION_MODES.has(payoutMode)) {
    errors.push('TASKER_PAYOUT_EXECUTION_MODE must be disabled or manual');
  }
  const walletCurrency = (environment.TASKER_WALLET_CURRENCY ?? 'USD').toUpperCase();
  if (!CURRENCY_PATTERN.test(walletCurrency)) {
    errors.push('TASKER_WALLET_CURRENCY must be a three-letter ISO-style currency code');
  }
  const minimumWithdrawal = Number(environment.TASKER_MIN_WITHDRAWAL_AMOUNT ?? '1');
  if (!Number.isFinite(minimumWithdrawal) || minimumWithdrawal <= 0) {
    errors.push('TASKER_MIN_WITHDRAWAL_AMOUNT must be a positive number');
  }
  if (present(environment.PAYOUT_DATA_ENCRYPTION_KEY)) {
    const rawKey = (environment.PAYOUT_DATA_ENCRYPTION_KEY as string).trim();
    const hexKey = /^[a-fA-F0-9]{64}$/.test(rawKey);
    let base64Key = false;
    if (!hexKey) {
      try {
        base64Key = Buffer.from(rawKey, 'base64').length === 32;
      } catch {
        base64Key = false;
      }
    }
    if (!hexKey && !base64Key) {
      errors.push('PAYOUT_DATA_ENCRYPTION_KEY must be 64 hex characters or base64-encoded 32 bytes');
    }
  }

  if (!BODY_LIMIT_PATTERN.test(environment.REQUEST_BODY_LIMIT ?? '1mb')) {
    errors.push('REQUEST_BODY_LIMIT must use a value such as 512kb or 1mb');
  }

  if (nodeEnvironment !== 'test') {
    const required = [
      'DATABASE_URL',
      'JWT_SECRET',
      'JWT_SECRET_ADMIN',
      'SMTP_HOST',
      'SMTP_FROM',
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
    ] as const;
    for (const key of required) {
      if (!present(environment[key])) errors.push(`${key} is required`);
    }
  }

  if (
    present(environment.DATABASE_URL) &&
    !isPostgresUrl(environment.DATABASE_URL as string)
  ) {
    errors.push('DATABASE_URL must be a valid PostgreSQL URL');
  }


  if (
    present(environment.CLOUDINARY_FOLDER) &&
    !/^[a-zA-Z0-9/_-]+$/.test(environment.CLOUDINARY_FOLDER as string)
  ) {
    errors.push('CLOUDINARY_FOLDER may contain only letters, numbers, slash, underscore, and hyphen');
  }

  const smtpUserPresent = present(environment.SMTP_USER);
  const smtpPasswordPresent = present(environment.SMTP_PASSWORD);
  if (smtpUserPresent !== smtpPasswordPresent) {
    errors.push('SMTP_USER and SMTP_PASSWORD must either both be set or both be empty');
  }
  if (
    present(environment.SMTP_FROM) &&
    !EMAIL_FROM_PATTERN.test(environment.SMTP_FROM as string)
  ) {
    errors.push('SMTP_FROM must be an email address or a Name <email> mailbox');
  }

  if (present(environment.APP_BASE_URL) && !isHttpUrl(environment.APP_BASE_URL as string)) {
    errors.push('APP_BASE_URL must be a valid http(s) URL');
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
    const secretKeys = ['JWT_SECRET', 'JWT_SECRET_ADMIN'] as const;
    for (const key of secretKeys) {
      const value = environment[key];
      if (!value || value.length < 32) {
        errors.push(`${key} must contain at least 32 characters`);
      }
    }
    if (environment.JWT_SECRET === environment.JWT_SECRET_ADMIN) {
      errors.push('JWT_SECRET and JWT_SECRET_ADMIN must be different values');
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

    if ((environment.SMTP_FROM ?? '').toLowerCase().includes('@example.com')) {
      errors.push('SMTP_FROM must use a non-example sender domain');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }
  return environment;
};
