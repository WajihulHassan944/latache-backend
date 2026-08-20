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

const asStringList = (value: string | undefined, fallback: readonly string[] = []): string[] =>
  (value ?? fallback.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export default () => {
  const nodeEnvironment = process.env.NODE_ENV ?? 'local';
  const supportedLocales = asStringList(process.env.SUPPORTED_LOCALES, ['en', 'ar', 'ary']).map(
    (locale) => locale.toLowerCase(),
  );
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
      swaggerEnabled: asBoolean(process.env.SWAGGER_ENABLED, nodeEnvironment !== 'production'),
      trustProxy: asBoolean(process.env.TRUST_PROXY, false),
      serviceMode: process.env.SERVICE_MODE ?? 'all',
      compressionEnabled: asBoolean(process.env.HTTP_COMPRESSION_ENABLED, true),
      compressionThresholdBytes: asPositiveInteger(
        process.env.HTTP_COMPRESSION_THRESHOLD_BYTES,
        1_024,
      ),
    },
    database: {
      url: process.env.DATABASE_URL,
      logging: asBoolean(process.env.DB_LOGGING, false),
      transactionMaxWaitMs: asPositiveInteger(process.env.DB_TRANSACTION_MAX_WAIT_MS, 15_000),
      transactionTimeoutMs: asPositiveInteger(process.env.DB_TRANSACTION_TIMEOUT_MS, 30_000),
      poolMaxPerInstance: asPositiveInteger(process.env.DB_POOL_MAX_PER_INSTANCE, 10),
      poolIdleTimeoutMs: asPositiveInteger(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30_000),
      poolConnectionTimeoutMs: asPositiveInteger(process.env.DB_POOL_CONNECTION_TIMEOUT_MS, 5_000),
      slowQueryMs: asPositiveInteger(process.env.DB_SLOW_QUERY_MS, 750),
    },
    redis: {
      url: process.env.REDIS_URL,
      enabled: asBoolean(process.env.REDIS_ENABLED, Boolean(process.env.REDIS_URL)),
      required: asBoolean(process.env.REDIS_REQUIRED, false),
      connectTimeoutMs: asPositiveInteger(process.env.REDIS_CONNECT_TIMEOUT_MS, 2_000),
    },
    cache: {
      enabled: asBoolean(process.env.CACHE_ENABLED, true),
      prefix: process.env.CACHE_KEY_PREFIX ?? 'latache:v1',
      servicesTtlSeconds: asPositiveInteger(process.env.CACHE_SERVICES_TTL_SECONDS, 300),
      settingsTtlSeconds: asPositiveInteger(process.env.CACHE_SETTINGS_TTL_SECONDS, 300),
      eliteTtlSeconds: asPositiveInteger(process.env.CACHE_ELITE_TTL_SECONDS, 120),
      adminAnalyticsTtlSeconds: asPositiveInteger(
        process.env.CACHE_ADMIN_ANALYTICS_TTL_SECONDS,
        30,
      ),
    },
    jobs: {
      enabled: asBoolean(process.env.JOBS_ENABLED, false),
      workerEnabled: asBoolean(process.env.JOB_WORKER_ENABLED, false),
      schedulerEnabled: asBoolean(process.env.JOB_SCHEDULER_ENABLED, false),
      maintenanceQueueName: process.env.JOB_MAINTENANCE_QUEUE_NAME ?? 'latache-maintenance-v1',
      workerConcurrency: asPositiveInteger(process.env.JOB_WORKER_CONCURRENCY, 4),
      attempts: asPositiveInteger(process.env.JOB_ATTEMPTS, 5),
      lockDurationMs: asPositiveInteger(process.env.JOB_LOCK_DURATION_MS, 60_000),
      healthTimeoutMs: asPositiveInteger(process.env.JOB_HEALTH_TIMEOUT_MS, 2_000),
      outboxCleanupIntervalMs: asPositiveInteger(
        process.env.REALTIME_OUTBOX_CLEANUP_INTERVAL_MS,
        3_600_000,
      ),
      outboxCleanupBatchSize: asPositiveInteger(
        process.env.REALTIME_OUTBOX_CLEANUP_BATCH_SIZE,
        1_000,
      ),
    },
    bookingCompletion: {
      approvalHours: asPositiveInteger(process.env.BOOKING_COMPLETION_APPROVAL_HOURS, 24),
      sweepIntervalMs: asPositiveInteger(process.env.BOOKING_COMPLETION_SWEEP_INTERVAL_MS, 60_000),
      batchSize: asPositiveInteger(process.env.BOOKING_COMPLETION_BATCH_SIZE, 100),
    },
    observability: {
      slowRequestMs: asPositiveInteger(process.env.SLOW_REQUEST_MS, 1_000),
    },
    localization: {
      supportedLocales,
      defaultLocale: (process.env.DEFAULT_LOCALE ?? 'en').trim().toLowerCase(),
    },
    realtime: {
      enabled: asBoolean(process.env.REALTIME_ENABLED, true),
      outboxPollMs: asPositiveInteger(process.env.REALTIME_OUTBOX_POLL_MS, 500),
      outboxBatchSize: asPositiveInteger(process.env.REALTIME_OUTBOX_BATCH_SIZE, 100),
      outboxLockMs: asPositiveInteger(process.env.REALTIME_OUTBOX_LOCK_MS, 30_000),
      outboxRetentionHours: asPositiveInteger(process.env.REALTIME_OUTBOX_RETENTION_HOURS, 24),
      sessionSweepMs: asPositiveInteger(process.env.REALTIME_SESSION_SWEEP_MS, 30_000),
      typingThrottleMs: asPositiveInteger(process.env.REALTIME_TYPING_THROTTLE_MS, 300),
      locationMinWriteIntervalMs: asPositiveInteger(
        process.env.REALTIME_LOCATION_MIN_WRITE_INTERVAL_MS,
        1_000,
      ),
    },
    chat: {
      attachmentMaxFiles: asPositiveInteger(process.env.CHAT_ATTACHMENT_MAX_FILES, 5),
      attachmentMaxFileSizeBytes: asPositiveInteger(
        process.env.CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES,
        10 * 1024 * 1024,
      ),
      attachmentMaxTotalSizeBytes: asPositiveInteger(
        process.env.CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES,
        25 * 1024 * 1024,
      ),
      callsEnabled: asBoolean(process.env.CHAT_CALLS_ENABLED, true),
      callRingTimeoutSeconds: asPositiveInteger(process.env.CHAT_CALL_RING_TIMEOUT_SECONDS, 45),
      callMaxDurationSeconds: asPositiveInteger(
        process.env.CHAT_CALL_MAX_DURATION_SECONDS,
        4 * 60 * 60,
      ),
      callSweepMs: asPositiveInteger(process.env.CHAT_CALL_SWEEP_MS, 5_000),
      callSignalMaxPerMinute: asPositiveInteger(process.env.CHAT_CALL_SIGNAL_MAX_PER_MINUTE, 300),
      callAllowedBookingStatuses: asStringList(process.env.CHAT_CALL_ALLOWED_BOOKING_STATUSES, [
        'confirmed',
        'en_route',
        'arrived',
        'in_progress',
      ]),
    },
    webrtc: {
      stunUrls: asStringList(process.env.WEBRTC_STUN_URLS),
      turnUrls: asStringList(process.env.WEBRTC_TURN_URLS),
      turnUsername: process.env.WEBRTC_TURN_USERNAME,
      turnCredential: process.env.WEBRTC_TURN_CREDENTIAL,
      turnSharedSecret: process.env.WEBRTC_TURN_SHARED_SECRET,
      turnCredentialTtlSeconds: asPositiveInteger(
        process.env.WEBRTC_TURN_CREDENTIAL_TTL_SECONDS,
        3_600,
      ),
    },
    auth: {
      jwtSecret: process.env.JWT_SECRET,
      adminJwtSecret: process.env.JWT_SECRET_ADMIN,
      otpHashSecret: process.env.OTP_HASH_SECRET ?? process.env.JWT_SECRET,
      accessTokenExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
      refreshTokenExpiresInDays: asPositiveInteger(process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS, 30),
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
      minimumWithdrawalAmount: asPositiveNumber(process.env.TASKER_MIN_WITHDRAWAL_AMOUNT, 1),
    },
    taskerFinance: {
      workerEnabled: asBoolean(process.env.TASKER_EARNINGS_WORKER_ENABLED, true),
      workerPollMs: asPositiveInteger(process.env.TASKER_EARNINGS_WORKER_POLL_MS, 60_000),
      workerBatchSize: asPositiveInteger(process.env.TASKER_EARNINGS_WORKER_BATCH_SIZE, 100),
      defaultClearanceDays: asPositiveInteger(process.env.TASKER_EARNINGS_CLEARANCE_DAYS, 14),
      defaultCashDisputeDays: asPositiveInteger(process.env.TASKER_CASH_DISPUTE_CLEARANCE_DAYS, 14),
    },
    referrals: {
      workerPollMs: asPositiveInteger(process.env.REFERRAL_WORKER_POLL_MS, 60_000),
      workerBatchSize: asPositiveInteger(process.env.REFERRAL_WORKER_BATCH_SIZE, 100),
    },
    disputes: {
      workerPollMs: asPositiveInteger(process.env.DISPUTE_WORKER_POLL_MS, 60_000),
    },
    elite: {
      workerPollMs: asPositiveInteger(process.env.ELITE_WORKER_POLL_MS, 21_600_000),
      workerBatchSize: asPositiveInteger(process.env.ELITE_WORKER_BATCH_SIZE, 200),
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
    objectStorageDeletion: {
      batchSize: asPositiveInteger(process.env.OBJECT_STORAGE_PURGE_BATCH_SIZE, 100),
      retryBaseSeconds: asPositiveInteger(process.env.OBJECT_STORAGE_PURGE_RETRY_BASE_SECONDS, 60),
      workerIntervalMs: asPositiveInteger(
        process.env.OBJECT_STORAGE_PURGE_WORKER_INTERVAL_MS,
        60_000,
      ),
      lockTimeoutMs: asPositiveInteger(
        process.env.OBJECT_STORAGE_PURGE_LOCK_TIMEOUT_MS,
        5 * 60_000,
      ),
    },
    mail: {
      host: process.env.SMTP_HOST,
      port: asPositiveInteger(process.env.SMTP_PORT, 587),
      secure: asBoolean(process.env.SMTP_SECURE, false),
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
      from: process.env.SMTP_FROM,
      tlsRejectUnauthorized: asBoolean(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true),
      verifyOnBootstrap: asBoolean(process.env.SMTP_VERIFY_ON_BOOTSTRAP, false),
      connectionTimeoutMs: asPositiveInteger(process.env.SMTP_CONNECTION_TIMEOUT_MS, 10_000),
      greetingTimeoutMs: asPositiveInteger(process.env.SMTP_GREETING_TIMEOUT_MS, 10_000),
      socketTimeoutMs: asPositiveInteger(process.env.SMTP_SOCKET_TIMEOUT_MS, 30_000),
    },
  };
};
