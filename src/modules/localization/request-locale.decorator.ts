import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { LocalizedRequest } from './localization.types';

export const RequestLocale = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => {
    const request = context.switchToHttp().getRequest<Request & LocalizedRequest>();
    return request.locale ?? 'en';
  },
);
