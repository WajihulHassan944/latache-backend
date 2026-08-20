type Environment = Record<string, string | undefined>;

const SUPPORTED_ENVIRONMENTS = new Set(['local', 'test', 'development', 'staging', 'production']);
const DURATION_PATTERN = /^\d+[smhd]$/;
const BODY_LIMIT_PATTERN = /^\d+(?:b|kb|mb|gb)$/i;
const EMAIL_FROM_PATTERN = /^(?:[^<>]+\s*)?<[^<>\s]+@[^<>\s]+>$|^[^\s@]+@[^\s@]+$/;
const PAYOUT_EXECUTION_MODES = new Set(['disabled', 'manual']);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PLATFORM_CURRENCIES = new Set(['USD', 'MAD', 'PKR', 'EUR']);
const CALL_BOOKING_STATUSES = new Set(['confirmed', 'en_route', 'arrived', 'in_progress']);
const LOCALE_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/;
const SERVICE_MODES = new Set(['api', 'worker', 'all']);

const present = (value: string | undefined): boolean => Boolean(value?.trim());
const isProductionLike = (value: string): boolean => value === 'production' || value === 'staging';

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

const isRedisUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === 'redis:' || url.protocol === 'rediss:';
  } catch {
    return false;
  }
};

export const validateEnvironment = (environment: Environment): Environment => {
  const errors: string[] = [];
  const nodeEnvironment = environment.NODE_ENV ?? 'local';
  const supportedLocales = (environment.SUPPORTED_LOCALES ?? 'en,ar,ary')
    .split(',')
    .map((locale) => locale.trim().toLowerCase())
    .filter(Boolean);
  const defaultLocale = (environment.DEFAULT_LOCALE ?? 'en').trim().toLowerCase();

  if (
    supportedLocales.length === 0 ||
    new Set(supportedLocales).size !== supportedLocales.length ||
    supportedLocales.some((locale) => !LOCALE_PATTERN.test(locale))
  ) {
    errors.push('SUPPORTED_LOCALES must be a unique comma-separated list of BCP-47 locale codes');
  }
  if (!LOCALE_PATTERN.test(defaultLocale) || !supportedLocales.includes(defaultLocale)) {
    errors.push('DEFAULT_LOCALE must be included in SUPPORTED_LOCALES');
  }

  if (!SUPPORTED_ENVIRONMENTS.has(nodeEnvironment)) {
    errors.push(`NODE_ENV must be one of: ${[...SUPPORTED_ENVIRONMENTS].join(', ')}`);
  }
  if (!SERVICE_MODES.has(environment.SERVICE_MODE ?? 'all')) {
    errors.push('SERVICE_MODE must be api, worker, or all');
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
  validateInteger(errors, 'OTP_EXPIRES_IN_MINUTES', environment.OTP_EXPIRES_IN_MINUTES, 5, 1, 60);
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
    'SMTP_CONNECTION_TIMEOUT_MS',
    environment.SMTP_CONNECTION_TIMEOUT_MS,
    10_000,
    1_000,
    120_000,
  );
  validateInteger(
    errors,
    'SMTP_GREETING_TIMEOUT_MS',
    environment.SMTP_GREETING_TIMEOUT_MS,
    10_000,
    1_000,
    120_000,
  );
  validateInteger(
    errors,
    'SMTP_SOCKET_TIMEOUT_MS',
    environment.SMTP_SOCKET_TIMEOUT_MS,
    30_000,
    1_000,
    300_000,
  );
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
    'DB_POOL_MAX_PER_INSTANCE',
    environment.DB_POOL_MAX_PER_INSTANCE,
    10,
    1,
    100,
  );
  validateInteger(
    errors,
    'DB_POOL_IDLE_TIMEOUT_MS',
    environment.DB_POOL_IDLE_TIMEOUT_MS,
    30_000,
    1_000,
    300_000,
  );
  validateInteger(
    errors,
    'DB_POOL_CONNECTION_TIMEOUT_MS',
    environment.DB_POOL_CONNECTION_TIMEOUT_MS,
    5_000,
    500,
    60_000,
  );
  validateInteger(errors, 'DB_SLOW_QUERY_MS', environment.DB_SLOW_QUERY_MS, 750, 50, 60_000);
  validateInteger(
    errors,
    'REDIS_CONNECT_TIMEOUT_MS',
    environment.REDIS_CONNECT_TIMEOUT_MS,
    2_000,
    250,
    60_000,
  );
  validateInteger(
    errors,
    'HTTP_COMPRESSION_THRESHOLD_BYTES',
    environment.HTTP_COMPRESSION_THRESHOLD_BYTES,
    1_024,
    0,
    10 * 1024 * 1024,
  );
  validateInteger(
    errors,
    'CACHE_SERVICES_TTL_SECONDS',
    environment.CACHE_SERVICES_TTL_SECONDS,
    300,
    1,
    86_400,
  );
  validateInteger(
    errors,
    'CACHE_SETTINGS_TTL_SECONDS',
    environment.CACHE_SETTINGS_TTL_SECONDS,
    300,
    1,
    86_400,
  );
  validateInteger(
    errors,
    'CACHE_ELITE_TTL_SECONDS',
    environment.CACHE_ELITE_TTL_SECONDS,
    120,
    1,
    86_400,
  );
  validateInteger(
    errors,
    'CACHE_ADMIN_ANALYTICS_TTL_SECONDS',
    environment.CACHE_ADMIN_ANALYTICS_TTL_SECONDS,
    30,
    1,
    3_600,
  );
  validateInteger(errors, 'JOB_WORKER_CONCURRENCY', environment.JOB_WORKER_CONCURRENCY, 4, 1, 100);
  validateInteger(errors, 'JOB_ATTEMPTS', environment.JOB_ATTEMPTS, 5, 1, 20);
  validateInteger(
    errors,
    'JOB_LOCK_DURATION_MS',
    environment.JOB_LOCK_DURATION_MS,
    60_000,
    5_000,
    600_000,
  );
  validateInteger(
    errors,
    'JOB_HEALTH_TIMEOUT_MS',
    environment.JOB_HEALTH_TIMEOUT_MS,
    2_000,
    250,
    30_000,
  );
  validateInteger(
    errors,
    'REALTIME_OUTBOX_CLEANUP_INTERVAL_MS',
    environment.REALTIME_OUTBOX_CLEANUP_INTERVAL_MS,
    3_600_000,
    60_000,
    86_400_000,
  );
  validateInteger(
    errors,
    'REALTIME_OUTBOX_CLEANUP_BATCH_SIZE',
    environment.REALTIME_OUTBOX_CLEANUP_BATCH_SIZE,
    1_000,
    1,
    10_000,
  );
  validateInteger(
    errors,
    'BOOKING_COMPLETION_APPROVAL_HOURS',
    environment.BOOKING_COMPLETION_APPROVAL_HOURS,
    24,
    1,
    168,
  );
  validateInteger(
    errors,
    'BOOKING_COMPLETION_SWEEP_INTERVAL_MS',
    environment.BOOKING_COMPLETION_SWEEP_INTERVAL_MS,
    60_000,
    5_000,
    3_600_000,
  );
  validateInteger(
    errors,
    'BOOKING_COMPLETION_BATCH_SIZE',
    environment.BOOKING_COMPLETION_BATCH_SIZE,
    100,
    1,
    1_000,
  );
  validateInteger(
    errors,
    'REALTIME_TYPING_THROTTLE_MS',
    environment.REALTIME_TYPING_THROTTLE_MS,
    300,
    100,
    5_000,
  );
  validateInteger(
    errors,
    'REALTIME_LOCATION_MIN_WRITE_INTERVAL_MS',
    environment.REALTIME_LOCATION_MIN_WRITE_INTERVAL_MS,
    1_000,
    250,
    30_000,
  );
  validateInteger(errors, 'SLOW_REQUEST_MS', environment.SLOW_REQUEST_MS, 1_000, 50, 60_000);
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
  validateInteger(
    errors,
    'OBJECT_STORAGE_PURGE_BATCH_SIZE',
    environment.OBJECT_STORAGE_PURGE_BATCH_SIZE,
    100,
    1,
    1_000,
  );
  validateInteger(
    errors,
    'OBJECT_STORAGE_PURGE_RETRY_BASE_SECONDS',
    environment.OBJECT_STORAGE_PURGE_RETRY_BASE_SECONDS,
    60,
    1,
    86_400,
  );
  validateInteger(
    errors,
    'OBJECT_STORAGE_PURGE_WORKER_INTERVAL_MS',
    environment.OBJECT_STORAGE_PURGE_WORKER_INTERVAL_MS,
    60_000,
    5_000,
    86_400_000,
  );
  validateInteger(
    errors,
    'OBJECT_STORAGE_PURGE_LOCK_TIMEOUT_MS',
    environment.OBJECT_STORAGE_PURGE_LOCK_TIMEOUT_MS,
    300_000,
    30_000,
    86_400_000,
  );
  validateInteger(
    errors,
    'REALTIME_OUTBOX_POLL_MS',
    environment.REALTIME_OUTBOX_POLL_MS,
    500,
    100,
    60_000,
  );
  validateInteger(
    errors,
    'REALTIME_OUTBOX_BATCH_SIZE',
    environment.REALTIME_OUTBOX_BATCH_SIZE,
    100,
    1,
    1_000,
  );
  validateInteger(
    errors,
    'REALTIME_OUTBOX_LOCK_MS',
    environment.REALTIME_OUTBOX_LOCK_MS,
    30_000,
    1_000,
    300_000,
  );
  validateInteger(
    errors,
    'REALTIME_OUTBOX_RETENTION_HOURS',
    environment.REALTIME_OUTBOX_RETENTION_HOURS,
    24,
    1,
    720,
  );
  validateInteger(
    errors,
    'REALTIME_SESSION_SWEEP_MS',
    environment.REALTIME_SESSION_SWEEP_MS,
    30_000,
    1_000,
    300_000,
  );
  validateInteger(
    errors,
    'TASKER_EARNINGS_WORKER_POLL_MS',
    environment.TASKER_EARNINGS_WORKER_POLL_MS,
    60_000,
    1_000,
    3_600_000,
  );
  validateInteger(
    errors,
    'TASKER_EARNINGS_WORKER_BATCH_SIZE',
    environment.TASKER_EARNINGS_WORKER_BATCH_SIZE,
    100,
    1,
    1_000,
  );
  validateInteger(
    errors,
    'TASKER_EARNINGS_CLEARANCE_DAYS',
    environment.TASKER_EARNINGS_CLEARANCE_DAYS,
    14,
    1,
    365,
  );
  validateInteger(
    errors,
    'TASKER_CASH_DISPUTE_CLEARANCE_DAYS',
    environment.TASKER_CASH_DISPUTE_CLEARANCE_DAYS,
    14,
    1,
    365,
  );
  validateInteger(
    errors,
    'REFERRAL_WORKER_POLL_MS',
    environment.REFERRAL_WORKER_POLL_MS,
    60_000,
    1_000,
    3_600_000,
  );
  validateInteger(
    errors,
    'REFERRAL_WORKER_BATCH_SIZE',
    environment.REFERRAL_WORKER_BATCH_SIZE,
    100,
    1,
    1_000,
  );
  validateInteger(
    errors,
    'ELITE_WORKER_POLL_MS',
    environment.ELITE_WORKER_POLL_MS,
    21_600_000,
    60_000,
    86_400_000,
  );
  validateInteger(
    errors,
    'ELITE_WORKER_BATCH_SIZE',
    environment.ELITE_WORKER_BATCH_SIZE,
    200,
    1,
    1_000,
  );
  validateInteger(
    errors,
    'CHAT_ATTACHMENT_MAX_FILES',
    environment.CHAT_ATTACHMENT_MAX_FILES,
    5,
    1,
    5,
  );
  validateInteger(
    errors,
    'CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES',
    environment.CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES,
    10 * 1024 * 1024,
    1024,
    10 * 1024 * 1024,
  );
  validateInteger(
    errors,
    'CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES',
    environment.CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES,
    25 * 1024 * 1024,
    1024,
    50 * 1024 * 1024,
  );
  validateInteger(
    errors,
    'CHAT_CALL_RING_TIMEOUT_SECONDS',
    environment.CHAT_CALL_RING_TIMEOUT_SECONDS,
    45,
    10,
    180,
  );
  validateInteger(
    errors,
    'CHAT_CALL_MAX_DURATION_SECONDS',
    environment.CHAT_CALL_MAX_DURATION_SECONDS,
    14_400,
    60,
    28_800,
  );
  validateInteger(
    errors,
    'CHAT_CALL_SWEEP_MS',
    environment.CHAT_CALL_SWEEP_MS,
    5_000,
    1_000,
    60_000,
  );
  validateInteger(
    errors,
    'CHAT_CALL_SIGNAL_MAX_PER_MINUTE',
    environment.CHAT_CALL_SIGNAL_MAX_PER_MINUTE,
    300,
    30,
    2_000,
  );
  validateInteger(
    errors,
    'WEBRTC_TURN_CREDENTIAL_TTL_SECONDS',
    environment.WEBRTC_TURN_CREDENTIAL_TTL_SECONDS,
    3_600,
    300,
    86_400,
  );
  validateDuration(errors, 'JWT_EXPIRES_IN', environment.JWT_EXPIRES_IN, '15m');

  const chatPerFileLimit = Number.parseInt(
    environment.CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES ?? String(10 * 1024 * 1024),
    10,
  );
  const chatTotalLimit = Number.parseInt(
    environment.CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES ?? String(25 * 1024 * 1024),
    10,
  );
  const cloudinaryLimit = Number.parseInt(
    environment.CLOUDINARY_MAX_FILE_SIZE_BYTES ?? String(10 * 1024 * 1024),
    10,
  );
  if (
    Number.isFinite(chatPerFileLimit) &&
    Number.isFinite(cloudinaryLimit) &&
    chatPerFileLimit > cloudinaryLimit
  ) {
    errors.push('CHAT_ATTACHMENT_MAX_FILE_SIZE_BYTES cannot exceed CLOUDINARY_MAX_FILE_SIZE_BYTES');
  }
  if (
    Number.isFinite(chatPerFileLimit) &&
    Number.isFinite(chatTotalLimit) &&
    chatTotalLimit < chatPerFileLimit
  ) {
    errors.push(
      'CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES must be at least the per-file attachment limit',
    );
  }

  const callStatuses = (
    environment.CHAT_CALL_ALLOWED_BOOKING_STATUSES ?? 'confirmed,en_route,arrived,in_progress'
  )
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean);
  if (callStatuses.length === 0) {
    errors.push('CHAT_CALL_ALLOWED_BOOKING_STATUSES must contain at least one status');
  }
  for (const status of callStatuses) {
    if (!CALL_BOOKING_STATUSES.has(status)) {
      errors.push(`CHAT_CALL_ALLOWED_BOOKING_STATUSES contains unsupported status: ${status}`);
    }
  }

  const stunUrls = (environment.WEBRTC_STUN_URLS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const url of stunUrls) {
    if (!url.startsWith('stun:') && !url.startsWith('stuns:')) {
      errors.push(`WEBRTC_STUN_URLS contains an invalid STUN URL: ${url}`);
    }
  }
  const turnUrls = (environment.WEBRTC_TURN_URLS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const url of turnUrls) {
    if (!url.startsWith('turn:') && !url.startsWith('turns:')) {
      errors.push(`WEBRTC_TURN_URLS contains an invalid TURN URL: ${url}`);
    }
  }
  const turnHasSharedSecret = present(environment.WEBRTC_TURN_SHARED_SECRET);
  const turnHasUsername = present(environment.WEBRTC_TURN_USERNAME);
  const turnHasCredential = present(environment.WEBRTC_TURN_CREDENTIAL);
  if (turnHasUsername !== turnHasCredential) {
    errors.push(
      'WEBRTC_TURN_USERNAME and WEBRTC_TURN_CREDENTIAL must either both be set or both be empty',
    );
  }
  if (turnUrls.length > 0 && !turnHasSharedSecret && !(turnHasUsername && turnHasCredential)) {
    errors.push(
      'TURN URLs require WEBRTC_TURN_SHARED_SECRET or both static TURN username and credential',
    );
  }
  if (turnHasSharedSecret && (environment.WEBRTC_TURN_SHARED_SECRET?.length ?? 0) < 16) {
    errors.push('WEBRTC_TURN_SHARED_SECRET must contain at least 16 characters');
  }

  const stripeEnabled = (environment.STRIPE_ENABLED ?? 'false').toLowerCase() === 'true';
  const paymentsCurrency = (environment.PAYMENTS_CURRENCY ?? 'USD').toUpperCase();
  if (!CURRENCY_PATTERN.test(paymentsCurrency) || !PLATFORM_CURRENCIES.has(paymentsCurrency)) {
    errors.push('PAYMENTS_CURRENCY must be one of USD, MAD, PKR, or EUR');
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
    if (!present(environment.STRIPE_SECRET_KEY))
      errors.push('STRIPE_SECRET_KEY is required when STRIPE_ENABLED=true');
    if (!present(environment.STRIPE_WEBHOOK_SECRET))
      errors.push('STRIPE_WEBHOOK_SECRET is required when STRIPE_ENABLED=true');
    if (
      present(environment.STRIPE_SECRET_KEY) &&
      !(environment.STRIPE_SECRET_KEY as string).startsWith('sk_')
    ) {
      errors.push('STRIPE_SECRET_KEY must be a Stripe secret key');
    }
    if (
      present(environment.STRIPE_WEBHOOK_SECRET) &&
      !(environment.STRIPE_WEBHOOK_SECRET as string).startsWith('whsec_')
    ) {
      errors.push('STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret');
    }
  }

  const payoutMode = environment.TASKER_PAYOUT_EXECUTION_MODE ?? 'disabled';
  if (!PAYOUT_EXECUTION_MODES.has(payoutMode)) {
    errors.push('TASKER_PAYOUT_EXECUTION_MODE must be disabled or manual');
  }
  const walletCurrency = (environment.TASKER_WALLET_CURRENCY ?? 'USD').toUpperCase();
  if (!CURRENCY_PATTERN.test(walletCurrency) || !PLATFORM_CURRENCIES.has(walletCurrency)) {
    errors.push('TASKER_WALLET_CURRENCY must be one of USD, MAD, PKR, or EUR');
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
      errors.push(
        'PAYOUT_DATA_ENCRYPTION_KEY must be 64 hex characters or base64-encoded 32 bytes',
      );
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

  if (present(environment.DATABASE_URL) && !isPostgresUrl(environment.DATABASE_URL as string)) {
    errors.push('DATABASE_URL must be a valid PostgreSQL URL');
  }

  const redisEnabled =
    (
      environment.REDIS_ENABLED ?? (present(environment.REDIS_URL) ? 'true' : 'false')
    ).toLowerCase() === 'true';
  const redisRequired = (environment.REDIS_REQUIRED ?? 'false').toLowerCase() === 'true';
  const jobsEnabled = (environment.JOBS_ENABLED ?? 'false').toLowerCase() === 'true';
  const jobSchedulerEnabled =
    (environment.JOB_SCHEDULER_ENABLED ?? 'false').toLowerCase() === 'true';
  if (present(environment.REDIS_URL) && !isRedisUrl(environment.REDIS_URL as string)) {
    errors.push('REDIS_URL must be a valid redis:// or rediss:// URL');
  }
  if (redisEnabled && !present(environment.REDIS_URL)) {
    errors.push('REDIS_URL is required when REDIS_ENABLED=true');
  }
  if (jobsEnabled && !redisEnabled) {
    errors.push('JOBS_ENABLED=true requires REDIS_ENABLED=true and a usable REDIS_URL');
  }
  if (
    ((environment.JOB_WORKER_ENABLED ?? 'false').toLowerCase() === 'true' ||
      (environment.JOB_SCHEDULER_ENABLED ?? 'false').toLowerCase() === 'true') &&
    !jobsEnabled
  ) {
    errors.push('JOB_WORKER_ENABLED/JOB_SCHEDULER_ENABLED require JOBS_ENABLED=true');
  }

  if (
    present(environment.CLOUDINARY_FOLDER) &&
    !/^[a-zA-Z0-9/_-]+$/.test(environment.CLOUDINARY_FOLDER as string)
  ) {
    errors.push(
      'CLOUDINARY_FOLDER may contain only letters, numbers, slash, underscore, and hyphen',
    );
  }

  const smtpUserPresent = present(environment.SMTP_USER);
  const smtpPasswordPresent = present(environment.SMTP_PASSWORD);
  if (smtpUserPresent !== smtpPasswordPresent) {
    errors.push('SMTP_USER and SMTP_PASSWORD must either both be set or both be empty');
  }
  if (present(environment.SMTP_FROM) && !EMAIL_FROM_PATTERN.test(environment.SMTP_FROM as string)) {
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
    if (!redisEnabled || !redisRequired || !jobsEnabled || !jobSchedulerEnabled) {
      errors.push(
        'Staging/production requires REDIS_ENABLED=true, REDIS_REQUIRED=true, JOBS_ENABLED=true, and JOB_SCHEDULER_ENABLED=true so durable maintenance and automatic booking completion cannot be silently disabled',
      );
    }
    const secretKeys = ['JWT_SECRET', 'JWT_SECRET_ADMIN', 'OTP_HASH_SECRET'] as const;
    for (const key of secretKeys) {
      const value = environment[key];
      if (!value || value.length < 32) {
        errors.push(`${key} must contain at least 32 characters`);
      }
    }
    if (environment.JWT_SECRET === environment.JWT_SECRET_ADMIN) {
      errors.push('JWT_SECRET and JWT_SECRET_ADMIN must be different values');
    }
    if (
      environment.OTP_HASH_SECRET === environment.JWT_SECRET ||
      environment.OTP_HASH_SECRET === environment.JWT_SECRET_ADMIN
    ) {
      errors.push('OTP_HASH_SECRET must be independent from both JWT signing secrets');
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

    const callsEnabled = (environment.CHAT_CALLS_ENABLED ?? 'true').toLowerCase() === 'true';
    if (callsEnabled && turnUrls.length === 0) {
      errors.push(
        'WEBRTC_TURN_URLS is required in staging/production when CHAT_CALLS_ENABLED=true',
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join('\n- ')}`);
  }
  return environment;
};
