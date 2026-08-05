const asBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true';
};

const asPositiveInteger = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export default () => {
  const nodeEnvironment = process.env.NODE_ENV ?? 'local';
  return {
    app: {
      environment: nodeEnvironment,
      port: asPositiveInteger(process.env.PORT, 8080),
      baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:8080',
      frontendBaseUrl: process.env.FRONTEND_BASE_URL ?? 'http://localhost:3000',
      timezone: process.env.APP_TIMEZONE ?? 'Africa/Casablanca',
      requestBodyLimit: process.env.REQUEST_BODY_LIMIT ?? '1mb',
      corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      swaggerEnabled: asBoolean(process.env.SWAGGER_ENABLED, nodeEnvironment !== 'production'),
      allowQueryTokenCompatibility: asBoolean(
        process.env.ALLOW_QUERY_TOKEN_COMPATIBILITY,
        false,
      ),
      trustProxy: asBoolean(process.env.TRUST_PROXY, false),
    },
    database: {
      url: process.env.DATABASE_URL,
      logging: asBoolean(process.env.DB_LOGGING, false),
    },
    auth: {
      jwtSecret: process.env.JWT_SECRET,
      adminJwtSecret: process.env.JWT_SECRET_ADMIN,
      accessTokenExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
      passwordResetSecret: process.env.PASSWORD_RESET_JWT_SECRET,
      passwordResetExpiresIn: process.env.PASS_JWT_EXPIRES_IN ?? '15m',
      refreshTokenExpiresInDays: asPositiveInteger(
        process.env.REFRESH_TOKEN_EXPIRES_IN_DAYS,
        30,
      ),
      bcryptRounds: asPositiveInteger(process.env.BCRYPT_ROUNDS, 12),
      otpExpiresInMinutes: asPositiveInteger(process.env.OTP_EXPIRES_IN_MINUTES, 5),
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
