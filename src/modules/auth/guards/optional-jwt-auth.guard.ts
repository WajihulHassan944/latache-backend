import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request';
import { extractBearerToken } from '../../../common/utils/token.util';
import { JwtAuthGuard } from './jwt-auth.guard';

/**
 * For public endpoints that behave differently for a signed-in user: no bearer
 * token passes as a guest, but a token that IS sent must be fully valid
 * (same checks as JwtAuthGuard) rather than silently downgrading to guest.
 */
@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(private readonly jwtAuth: JwtAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!extractBearerToken(request.headers.authorization)) return true;
    return this.jwtAuth.canActivate(context);
  }
}
