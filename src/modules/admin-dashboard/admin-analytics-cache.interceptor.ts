import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { AppCacheService, CacheNamespace } from '../../infrastructure/redis/app-cache.service';

@Injectable()
export class AdminAnalyticsCacheInterceptor implements NestInterceptor {
  constructor(
    private readonly cache: AppCacheService,
    private readonly config: ConfigService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'private, no-cache');

    // The activity feed is operational and remains live. Aggregate endpoints
    // are shared platform facts protected by the existing guards, not per-user data.
    if (request.method !== 'GET' || request.path.endsWith('/activity')) return next.handle();

    const ttl = this.config.get<number>('cache.adminAnalyticsTtlSeconds', 30);
    return from(
      this.cache
        .getOrLoadWithStatus(
          CacheNamespace.AdminAnalytics,
          { path: request.path, query: request.query },
          ttl,
          () => lastValueFrom(next.handle()),
        )
        .then((result) => {
          response.setHeader('X-Latache-Cache', result.cache);
          response.setHeader('X-Latache-Analytics-Max-Age', String(ttl));
          return result.value;
        }),
    );
  }
}
