import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
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
  app.use(json({ limit: bodyLimit }));
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
          'Production API for Latache customers, taskers, administrators, services, and bookings. Authentication endpoints include role-specific signup, OTP verification, session rotation, password recovery, and RBAC.',
        )
        .setVersion('3.2.0')
        .addTag('01 Auth', 'Customer, tasker, admin, super-admin, session, and password flows')
        .addTag('services', 'Service catalogue')
        .addTag('taskers', 'Tasker discovery, availability and onboarding')
        .addTag('bookings', 'Customer bookings')
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
