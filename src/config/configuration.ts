const asBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
};

const asPositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const asPositiveNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const asNonNegativeNumber = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export default () => {
  const nodeEnvironment = process.env.NODE_ENV ?? 'local';
  return {
    app: {
      environment: nodeEnvironment,
      port: asPositiveInteger(process.env.PORT, 8080),
      baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:8080',
      timezone: process.env.APP_TIMEZONE ?? 'Africa/Casablanca',
      requestBodyLimit: process.env.REQUEST_BODY_LIMIT ?? '1mb',
      corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      swaggerEnabled: asBoolean(
        process.env.SWAGGER_ENABLED,
        nodeEnvironment !== 'production',
      ),
      trustProxy: asBoolean(process.env.TRUST_PROXY, false),
    },
    database: {
      url: process.env.DATABASE_URL,
      logging: asBoolean(process.env.DB_LOGGING, false),
      transactionMaxWaitMs: asPositiveInteger(
        process.env.DB_TRANSACTION_MAX_WAIT_MS,
        15_000,
      ),
      transactionTimeoutMs: asPositiveInteger(
        process.env.DB_TRANSACTION_TIMEOUT_MS,
        30_000,
      ),
    },
    auth: {
      jwtSecret: process.env.JWT_SECRET,
      adminJwtSecret: process.env.JWT_SECRET_ADMIN,
      accessTokenExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
      refreshTokenExpiresInDays: asPositiveInteger(
        process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS,
        30,
      ),
      bcryptRounds: asPositiveInteger(process.env.BCRYPT_ROUNDS, 12),
      otpExpiresInMinutes: asPositiveInteger(process.env.OTP_EXPIRES_IN_MINUTES, 5),
      passwordResetOtpExpiresInMinutes: asPositiveInteger(
        process.env.PASSWORD_RESET_OTP_EXPIRES_IN_MINUTES,
        15,
      ),
    },
    payments: {
      stripeEnabled: asBoolean(process.env.STRIPE_ENABLED, false),
      stripeSecretKey: process.env.STRIPE_SECRET_KEY,
      stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      currency: (process.env.PAYMENTS_CURRENCY ?? 'USD').trim().toUpperCase(),
      platformFeePercent: asNonNegativeNumber(process.env.PAYMENTS_PLATFORM_FEE_PERCENT, 0),
      minimumBillableMinutes: asPositiveInteger(process.env.BOOKING_MINIMUM_BILLABLE_MINUTES, 120),
      minimumWalletTopup: asPositiveNumber(process.env.CUSTOMER_WALLET_MIN_TOPUP, 5),
    },
    taskerPayout: {
      currency: (process.env.TASKER_WALLET_CURRENCY ?? 'USD').trim().toUpperCase(),
      executionMode: process.env.TASKER_PAYOUT_EXECUTION_MODE ?? 'disabled',
      encryptionKey: process.env.PAYOUT_DATA_ENCRYPTION_KEY,
      minimumWithdrawalAmount: asPositiveNumber(
        process.env.TASKER_MIN_WITHDRAWAL_AMOUNT,
        1,
      ),
    },
    cloudinary: {
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
      apiSecret: process.env.CLOUDINARY_API_SECRET,
      folder: process.env.CLOUDINARY_FOLDER ?? 'latache',
      maxFileSizeBytes: asPositiveInteger(
        process.env.CLOUDINARY_MAX_FILE_SIZE_BYTES,
        10 * 1024 * 1024,
      ),
    },
    mail: {
      host: process.env.SMTP_HOST,
      port: asPositiveInteger(process.env.SMTP_PORT, 587),
      secure: asBoolean(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
      from: process.env.SMTP_FROM,
      tlsRejectUnauthorized: asBoolean(
        process.env.SMTP_TLS_REJECT_UNAUTHORIZED,
        true,
      ),
      verifyOnBootstrap: asBoolean(process.env.SMTP_VERIFY_ON_BOOTSTRAP, false),
    },
  };
};
