import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded, type Request } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';

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
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.use(helmet());
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

  const express = app.getHttpAdapter().getInstance() as {
    set(setting: string, value: boolean): void;
  };
  express.set('trust proxy', config.get<boolean>('app.trustProxy', false));

  const allowedOrigins = new Set(config.get<string[]>('app.corsOrigins', []));
  app.enableCors({
    credentials: true,
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'), false);
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
          'Production API for Latache customers, taskers and administrators. Shared role-aware APIs cover dashboards, bookings, conversations, notifications and reviews; Stripe payment state is webhook-driven and financial APIs never fabricate success.',
        )
        .setVersion('3.10.0')
        .addTag('01 Auth', 'Customer, tasker, admin, super-admin, session, and password flows')
        .addTag('02 Uploads', 'Cloudinary signup, profile, identity, work-image, service-image, and booking-attachment uploads')
        .addTag('03 RBAC - Roles & Permissions', 'Administrator roles, permissions, assignments, and account access')
        .addTag('04 Dashboard', 'Role-aware customer/tasker dashboard overview')
        .addTag('05 Bookings & Tasks', 'Unified customer/tasker booking lifecycle, navigation, timer, rescheduling, extensions, and disputes')
        .addTag('06 Payments', 'Customer Stripe cards, SetupIntents, real wallet ledger, and booking payment state')
        .addTag('07 Conversations', 'Booking-backed conversations shared by customers and taskers')
        .addTag('08 Notifications', 'Role-aware persisted notification inbox')
        .addTag('09 Reviews', 'Booking-backed reviews shared by customers and taskers')
        .addTag('10 Favorites', 'Customer favorite taskers')
        .addTag('11 Tasker Profile & Skills', 'Tasker personal/business profile and active skills')
        .addTag('12 Tasker Wallet & Payouts', 'Ledger-backed tasker wallet, encrypted payout methods, and non-fabricated withdrawals')
        .addTag('13 Services', 'Service catalogue and optional booking service options')
        .addTag('14 Tasker Discovery', 'Tasker discovery, availability and onboarding')
        .addTag('24 Admin - Booking Management', 'Permission-aware booking operations, filtering, reporting, and safe lifecycle actions')
        .addTag('25 Admin - Dispute Management', 'Investigation, evidence, resolution drafts, refunds, warnings, and audit-backed dispute decisions')
        .addTag('health', 'Application and database health')
        .addBearerAuth(
          { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          'bearer',
        )
        .build(),
    );
    SwaggerModule.setup('api/docs', app, document, {
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
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
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  logger.error('Application failed to start', message);
  process.exitCode = 1;
});
