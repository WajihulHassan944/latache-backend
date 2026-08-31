import { setDefaultResultOrder } from 'node:dns';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { RealtimeIoAdapter } from './modules/realtime/realtime-io.adapter';
import { RedisService } from './infrastructure/redis/redis.service';
import { buildAllowedOrigins, normalizeHttpOrigin } from './common/utils/cors.util';

// Railway/Gmail SMTP may resolve an unreachable IPv6 address. Prefer IPv4 process-wide.
setDefaultResultOrder('ipv4first');

interface ValidationErrorNode {
  property: string;
  constraints?: Record<string, string>;
  children?: ValidationErrorNode[];
}

const flattenValidationErrors = (
  errors: ValidationErrorNode[],
  prefix = '',
): Array<{ field: string; messages: string[] }> =>
  errors.flatMap((error) => {
    const field = prefix ? `${prefix}.${error.property}` : error.property;
    const own = error.constraints
      ? [{ field, messages: Object.values(error.constraints) }]
      : [];
    const nested = error.children?.length
      ? flattenValidationErrors(error.children, field)
      : [];

    return [...own, ...nested];
  });

async function bootstrap(): Promise<void> {
  if ((process.env.SERVICE_MODE ?? 'all') === 'worker') {
    const context = await NestFactory.createApplicationContext(AppModule);
    context.enableShutdownHooks();

    new Logger('Bootstrap').log(
      'Latache background worker is running',
    );

    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    {
      bodyParser: false,
    },
  );

  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');

app.use(
  helmet({
    hsts: false,
  }),
);

  if (config.get<boolean>('app.compressionEnabled', true)) {
    app.use(
      compression({
        threshold: config.get<number>(
          'app.compressionThresholdBytes',
          1_024,
        ),
      }),
    );
  }

  const bodyLimit = config.get<string>(
    'app.requestBodyLimit',
    '1mb',
  );

  app.use(
    json({
      limit: bodyLimit,
      verify: (request, _response, buffer) => {
        const req = request as Request & { rawBody?: Buffer };

        if (
          req.originalUrl?.startsWith(
            '/api/payments/webhooks/stripe',
          )
        ) {
          req.rawBody = Buffer.from(buffer);
        }
      },
    }),
  );

  app.use(
    urlencoded({
      extended: true,
      limit: bodyLimit,
    }),
  );

  app.use(
    (
      request: Request,
      response: Response,
      next: NextFunction,
    ) => {
      response.vary('Accept-Encoding');

      const publicCatalogue =
        request.method === 'GET' &&
        !request.header('authorization') &&
        (request.path.startsWith('/api/services') ||
          request.path.startsWith('/api/platform/content'));

      if (publicCatalogue) {
        response.vary('Accept-Language');

        response.setHeader(
          'Cache-Control',
          'public, max-age=30, stale-while-revalidate=60',
        );
      } else if (
        request.path.startsWith('/api/auth') ||
        request.path.startsWith('/api/notifications') ||
        request.path.startsWith('/api/payments') ||
        request.path.includes('/wallet') ||
        request.path.includes('/finance')
      ) {
        response.setHeader(
          'Cache-Control',
          'private, no-store',
        );
      }

      next();
    },
  );

  const express = app.getHttpAdapter().getInstance() as {
    set(
      setting: string,
      value: boolean | string,
    ): void;
  };

  express.set(
    'trust proxy',
    config.get<boolean>(
      'app.trustProxy',
      false,
    ),
  );

  express.set('etag', 'weak');

  const allowedOrigins = buildAllowedOrigins(
    config.get<string[]>(
      'app.corsOrigins',
      [],
    ),
    config.get<string>('app.baseUrl'),
  );

  const realtimeAdapter = new RealtimeIoAdapter(
    app,
    allowedOrigins,
    app.get(RedisService),
  );

  await realtimeAdapter.connectToRedis();

  app.useWebSocketAdapter(realtimeAdapter);

  app.enableCors({
    credentials: true,
    methods: [
      'GET',
      'HEAD',
      'PUT',
      'PATCH',
      'POST',
      'DELETE',
      'OPTIONS',
    ],
    optionsSuccessStatus: 204,

    origin: (origin, callback) => {
      if (!origin) {
        return callback(null, true);
      }

      const normalizedOrigin =
        normalizeHttpOrigin(origin);

      return callback(
        null,
        Boolean(
          normalizedOrigin &&
            allowedOrigins.has(normalizedOrigin),
        ),
      );
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,

      transformOptions: {
        enableImplicitConversion: false,
      },

      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          errors: flattenValidationErrors(errors),
        }),
    }),
  );

  /*
   * Swagger
   *
   * Swagger intentionally does not define a hard-coded server URL.
   * This allows the same Swagger UI to work from whichever origin
   * is currently being used:
   *
   * HTTP:
   *   http://35.205.71.111/api/docs
   *
   * HTTPS:
   *   https://your-domain/api/docs
   *
   * The browser therefore keeps Swagger requests on the same origin.
   */
  if (
    config.get<boolean>(
      'app.swaggerEnabled',
      false,
    )
  ) {
    const document = SwaggerModule.createDocument(
      app,

      new DocumentBuilder()
        .setTitle('Latache API')

        .setDescription(
          'Production API for Latache customers, taskers and administrators. Dynamic catalogue content supports English (en), Arabic (ar), and Moroccan Darija (ary) through a saved user preference or Accept-Language with English/canonical fallback. UI labels and machine-readable domain codes remain frontend-owned and language-neutral. Shared role-aware APIs preserve provider-backed finance, transactional realtime, and persisted notification semantics.',
        )

        .setVersion('3.33.0')

        .addTag(
          '01 Auth',
          'Customer, tasker, admin, super-admin, session, and password flows',
        )

        .addTag(
          '02 Uploads',
          'Cloudinary signup, profile, identity, work-image, service-image, and booking-attachment uploads',
        )

        .addTag(
          '03 RBAC - Roles & Permissions',
          'Administrator roles, permissions, assignments, and account access',
        )

        .addTag(
          '04 Dashboard',
          'Role-aware customer/tasker dashboard overview',
        )

        .addTag(
          '05 Bookings & Tasks',
          'Unified customer/tasker booking lifecycle, navigation, timer, rescheduling, extensions, and disputes',
        )

        .addTag(
          '06 Payments',
          'Customer Stripe cards, SetupIntents, real wallet ledger, and booking payment state',
        )

        .addTag(
          '07 Conversations',
          'Booking-backed messages, verified document attachments, and persisted voice/video call history',
        )

        .addTag(
          '08 Notifications',
          'Role-aware persisted, template-backed localized notification inbox',
        )

        .addTag(
          '09 Reviews',
          'Booking-backed reviews shared by customers and taskers',
        )

        .addTag(
          '10 Favorites',
          'Customer favorite taskers',
        )

        .addTag(
          '11 Tasker Profile & Skills',
          'Tasker personal/business profile and active skills',
        )

        .addTag(
          '12 Tasker Wallet & Payouts',
          'Ledger-backed pending/available earnings, cash platform payables, encrypted payout methods, and non-fabricated withdrawals',
        )

        .addTag(
          '13 Services',
          'Localized service catalogue and optional booking service options',
        )

        .addTag(
          '14 Tasker Discovery',
          'Tasker discovery, availability and onboarding',
        )

        .addTag(
          '15 Support',
          'Shared customer/tasker support tickets and persisted live-chat conversations',
        )

        .addTag(
          '16 Realtime',
          'Authenticated Socket.IO contract for notifications, chat, booking state, live location, and WebRTC voice/video signaling',
        )

        .addTag(
          '33 Referrals',
          'Customer/Tasker referral codes, attribution, qualification, reward history, and optional masked leaderboard',
        )

        .addTag(
          '34 Admin - Referrals',
          'RBAC-controlled referral investigation and immutable reward clawbacks',
        )

        .addTag(
          '26 Admin - Payments & Finance',
          'Payment, earning-clearance, cash-receivable, payout, refund and revenue views backed by real financial records',
        )

        .addTag(
          '27 Admin - Support Center',
          'Permission-aware support queues, live chat, assignment, escalation and reports',
        )

        .addTag(
          '28 Admin - Service Management',
          'Service catalogue, sub-services, Tasker coverage and canonical pricing-policy views',
        )

        .addTag(
          '29 Admin - Review Moderation',
          'Permission-aware public review visibility moderation without rewriting author content',
        )

        .addTag(
          '24 Admin - Booking Management',
          'Permission-aware booking operations, filtering, reporting, and safe lifecycle actions',
        )

        .addTag(
          '25 Admin - Dispute Management',
          'Investigation, evidence, resolution drafts, refunds, warnings, and audit-backed dispute decisions',
        )

        .addTag(
          '30 SEO',
          'Public SEO metadata, robots.txt, XML sitemap, redirects, structured data, and RBAC-managed SEO configuration',
        )

        .addTag(
          'health',
          'API, PostgreSQL, Redis, BullMQ worker/queue and realtime outbox health',
        )

        .addBearerAuth(
          {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          'bearer',
        )

        .build(),
    );

    SwaggerModule.setup(
      'api/docs',
      app,
      document,
      {
        jsonDocumentUrl: 'api/docs-json',

        /*
         * app.setGlobalPrefix('api') is already configured above.
         * Swagger is explicitly mounted at /api/docs, so don't
         * apply the global prefix a second time.
         */
        useGlobalPrefix: false,

        swaggerOptions: {
          persistAuthorization: true,
          displayRequestDuration: true,
        },

        customSiteTitle:
          'Latache API Documentation',
      },
    );
  }

  app.enableShutdownHooks();

  const port = config.get<number>(
    'app.port',
    8080,
  );

  await app.listen(
    port,
    '0.0.0.0',
  );

  logger.log(
    `Latache API listening on http://localhost:${port}/api`,
  );
}

void bootstrap().catch(
  (error: unknown) => {
    const logger = new Logger('Bootstrap');

    const message =
      error instanceof Error
        ? (error.stack ?? error.message)
        : String(error);

    logger.error(
      'Application failed to start',
      message,
    );

    process.exitCode = 1;
  },
);