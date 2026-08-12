import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { mergeMap } from 'rxjs';
import type { User } from '../../generated/prisma/client';
import { LocaleService } from './locale.service';
import type { LocalizedRequest } from './localization.types';
import { ResponseLocalizationService } from './response-localization.service';

type RequestWithLocale = Request & LocalizedRequest & { user?: User };

@Injectable()
export class LocaleInterceptor implements NestInterceptor {
  constructor(
    private readonly locales: LocaleService,
    private readonly responses: ResponseLocalizationService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() === 'http') {
      const request = context.switchToHttp().getRequest<RequestWithLocale>();
      const response = context.switchToHttp().getResponse<Response>();
      const resolved = this.locales.resolve({
        preferredLanguage: request.user?.preferredLanguage,
        acceptLanguage: request.headers['accept-language'],
      });
      request.locale = resolved.locale;
      request.localeSource = resolved.source;
      response.setHeader('Content-Language', resolved.locale);
      response.vary('Accept-Language');
      return next
        .handle()
        .pipe(
          mergeMap((payload) =>
            this.responses.localize(payload, resolved.locale, request.originalUrl),
          ),
        );
    }
    return next.handle();
  }
}
