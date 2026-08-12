import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Observable, tap } from 'rxjs';
import { PerformanceMetricsService } from './performance-metrics.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HttpRequest');
  private readonly slowThresholdMs: number;

  constructor(
    config: ConfigService,
    private readonly metrics: PerformanceMetricsService,
  ) {
    this.slowThresholdMs = config.get<number>('observability.slowRequestMs', 1_000);
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<Request & { user?: { id?: number } }>();
    const response = context.switchToHttp().getResponse<Response>();
    const requestId = this.requestId(request);
    response.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    let failedStatus: number | null = null;

    return next.handle().pipe(
      tap({
        error: (error: unknown) => {
          failedStatus = error instanceof HttpException ? error.getStatus() : 500;
        },
        finalize: () => {
          const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
          const statusCode = failedStatus ?? response.statusCode;
          this.metrics.recordRequest(durationMs, statusCode, this.slowThresholdMs);
          const record = JSON.stringify({
            event: 'http_request',
            requestId,
            method: request.method,
            path: request.path,
            statusCode,
            durationMs: Math.round(durationMs * 100) / 100,
            userId: request.user?.id ?? null,
          });
          if (statusCode >= 500) this.logger.error(record);
          else if (durationMs >= this.slowThresholdMs) this.logger.warn(record);
          else this.logger.log(record);
        },
      }),
    );
  }

  private requestId(request: Request): string {
    const supplied = request.header('x-request-id')?.trim();
    return supplied && /^[a-zA-Z0-9._-]{8,128}$/.test(supplied) ? supplied : randomUUID();
  }
}
