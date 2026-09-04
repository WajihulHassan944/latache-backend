import { setDefaultResultOrder } from 'node:dns';
import { join } from 'node:path';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import {
  json,
  static as expressStatic,
  urlencoded,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
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
    const own = error.constraints ? [{ field, messages: Object.values(error.constraints) }] : [];
    const nested = error.children?.length ? flattenValidationErrors(error.children, field) : [];
    return [...own, ...nested];
  });

async function bootstrap(): Promise<void> {
  if ((process.env.SERVICE_MODE ?? 'all') === 'worker') {
    const context = await NestFactory.createApplicationContext(AppModule);
    context.enableShutdownHooks();
    new Logger('Bootstrap').log('Latache background worker is running');
    return;
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.use(helmet());
  if (config.get<boolean>('app.compressionEnabled', true)) {
    app.use(
      compression({
        threshold: config.get<number>('app.compressionThresholdBytes', 1_024),
      }),
    );
  }
  const bodyLimit = config.get<string>('app.requestBodyLimit', '1mb');
  app.use(
    json({
      limit: bodyLimit,
      verify: (request, _response, buffer) => {
        const req = request as Request & { rawBody?: Buffer };
        if (req.originalUrl?.startsWith('/api/payments/webhooks/stripe')) {
          req.rawBody = Buffer.from(buffer);
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.vary('Accept-Encoding');
    const publicCatalogue =
      request.method === 'GET' &&
      !request.header('authorization') &&
      (request.path.startsWith('/api/services') ||
        request.path.startsWith('/api/platform/content'));
    if (publicCatalogue) {
      response.vary('Accept-Language');
      response.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    } else if (
      request.path.startsWith('/api/auth') ||
      request.path.startsWith('/api/notifications') ||
      request.path.startsWith('/api/payments') ||
      request.path.includes('/wallet') ||
      request.path.includes('/finance')
    ) {
      response.setHeader('Cache-Control', 'private, no-store');
    }
    next();
  });

  const express = app.getHttpAdapter().getInstance() as {
    set(setting: string, value: boolean | string): void;
  };
  express.set('trust proxy', config.get<boolean>('app.trustProxy', false));
  express.set('etag', 'weak');

  const allowedOrigins = buildAllowedOrigins(
    config.get<string[]>('app.corsOrigins', []),
    config.get<string>('app.baseUrl'),
  );
  const realtimeAdapter = new RealtimeIoAdapter(app, allowedOrigins, app.get(RedisService));
  await realtimeAdapter.connectToRedis();
  app.useWebSocketAdapter(realtimeAdapter);
  app.enableCors({
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    optionsSuccessStatus: 204,
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeHttpOrigin(origin);
      return callback(null, Boolean(normalizedOrigin && allowedOrigins.has(normalizedOrigin)));
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) =>
        new BadRequestException({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          errors: flattenValidationErrors(errors),
        }),
    }),
  );

  if (config.get<boolean>('app.swaggerEnabled', false)) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Latache API')
        .setDescription(
          'Production API for Latache customers, taskers and administrators. Dynamic catalogue content supports English (en), Arabic (ar), and Moroccan Darija (ary) through a saved user preference or Accept-Language with English/canonical fallback. UI labels and machine-readable domain codes remain frontend-owned and language-neutral. Shared role-aware APIs preserve provider-backed finance, transactional realtime, and persisted notification semantics.',
        )
        .setVersion('3.33.0')
        .addServer('/', 'Current Swagger host')
        .addServer(
          config.get<string>('app.baseUrl', 'http://localhost:8080'),
          'Configured API origin',
        )
        // ============================================================
        // User-facing APIs (Customer/Tasker/public/guest). Auth stays at
        // 01, unchanged, as the shared entry point for every role.
        // ============================================================
        .addTag('01 Auth', 'Customer, tasker, admin, super-admin, session, and password flows')
        .addTag(
          '02 Guest Sessions',
          'Anonymous browsing sessions for public website read-only APIs, and the authenticated flow to link one to a real account after signup/login',
        )
        .addTag(
          '03 Platform',
          'Public platform content and current currency context, read-only',
        )
        .addTag(
          '04 Uploads',
          'Cloudinary signup, profile, identity, work-image, service-image, and booking-attachment uploads',
        )
        .addTag('05 Dashboard', 'Role-aware customer/tasker dashboard overview')
        .addTag(
          '06 Bookings & Tasks',
          'Unified customer/tasker booking lifecycle, navigation, timer, rescheduling, extensions, and disputes',
        )
        .addTag(
          '07 Payments',
          'Customer Stripe cards, SetupIntents, real wallet ledger, and booking payment state',
        )
        .addTag(
          '08 Conversations',
          'Booking-backed messages, verified document attachments, and persisted voice/video call history',
        )
        .addTag(
          '09 Notifications',
          'Role-aware persisted, template-backed localized notification inbox',
        )
        .addTag('10 Reviews', 'Booking-backed reviews shared by customers and taskers')
        .addTag('11 Favorites', 'Customer favorite taskers')
        .addTag('12 Tasker Profile & Skills', 'Tasker personal/business profile and active skills')
        .addTag(
          '13 Tasker Wallet & Payouts',
          'Ledger-backed pending/available earnings, cash platform payables, encrypted payout methods, and non-fabricated withdrawals',
        )
        .addTag(
          '14 Tasker - Elite Program',
          "A tasker's own Elite tier status, requirements progress, and membership request history",
        )
        .addTag('15 Services', 'Localized service catalogue and optional booking service options')
        .addTag('16 Tasker Discovery', 'Tasker discovery, availability and onboarding')
        .addTag(
          '17 Support',
          'Shared customer/tasker support tickets and persisted live-chat conversations',
        )
        .addTag(
          '18 Realtime',
          'Authenticated Socket.IO contract for notifications, chat, booking state, live location, and WebRTC voice/video signaling',
        )
        .addTag(
          '19 Content Management',
          'Public homepage sections and published content pages, read-only',
        )
        .addTag('20 SEO', 'Public SEO metadata, robots.txt, XML sitemap, redirects, and structured data')
        .addTag(
          '21 Referrals',
          'Customer/Tasker referral codes, attribution, qualification, reward history, and optional masked leaderboard',
        )
        // ============================================================
        // Admin APIs only. Every super-admin/administrator-facing
        // endpoint lives below this line, grouped together and gated by
        // AdminAuthGuard/PermissionsGuard.
        // ============================================================
        .addTag(
          '50 Admin - RBAC & Permissions',
          'Administrator roles, permissions, assignments, and account access',
        )
        .addTag(
          '51 Admin - Platform Settings',
          'Super-admin-owned booking, service-radius, commission/tax, and finance policy configuration',
        )
        .addTag('52 Admin - Dashboard Analytics', 'Platform-wide analytics and reporting overview')
        .addTag(
          '53 Admin - Dashboard Customers',
          'Permission-aware customer directory, moderation, and detail views',
        )
        .addTag(
          '54 Admin - Dashboard Taskers',
          'Permission-aware Tasker directory, verification queue, and moderation',
        )
        .addTag(
          '55 Admin - Elite Tasker Program',
          'RBAC-controlled Elite tier configuration, membership decisions, and evaluations',
        )
        .addTag(
          '56 Admin - Booking Management',
          'Permission-aware booking operations, filtering, reporting, and safe lifecycle actions',
        )
        .addTag(
          '57 Admin - Dispute Management',
          'Investigation, evidence, resolution drafts, refunds, warnings, and audit-backed dispute decisions',
        )
        .addTag(
          '58 Admin - Payments & Finance',
          'Payment, earning-clearance, cash-receivable, payout, refund and revenue views backed by real financial records',
        )
        .addTag(
          '59 Admin - Support Center',
          'Permission-aware support queues, live chat, assignment, escalation and reports',
        )
        .addTag(
          '60 Admin - Service Management',
          'Service catalogue, sub-services, Tasker coverage and canonical pricing-policy views',
        )
        .addTag(
          '61 Admin - Content Management',
          'RBAC-managed homepage sections and content page authoring/publishing',
        )
        .addTag(
          '62 Admin - Review Moderation',
          'Permission-aware public review visibility moderation without rewriting author content',
        )
        .addTag('63 Admin - SEO', 'RBAC-managed SEO configuration, redirects, and sitemap entries')
        .addTag(
          '64 Admin - Referrals',
          'RBAC-controlled referral investigation and immutable reward clawbacks',
        )
        .addTag('health', 'API, PostgreSQL, Redis, BullMQ worker/queue and realtime outbox health')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
        .build(),
    );
    // Explicitly expose Swagger UI's bundled assets from node_modules.
    // This is important on Vercel/serverless, where relying on the
    // framework-generated relative asset middleware can result in the
    // asset request being handled by the JSON/function route instead.
    app.use(
      '/api/docs',
      expressStatic(join(process.cwd(), 'node_modules', 'swagger-ui-dist'), {
        index: false,
        fallthrough: true,
      }),
    );

    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: '/api/docs-json',
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
        url: '/api/docs-json',
      },
      customSiteTitle: 'Latache API Documentation',
    });
  }

  app.enableShutdownHooks();
  const port = config.get<number>('app.port', 8080);
  await app.listen(port, '0.0.0.0');
  logger.log(`Latache API listening on http://localhost:${port}/api`);
}

void bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  logger.error('Application failed to start', message);
  process.exitCode = 1;
});
