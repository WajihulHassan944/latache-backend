import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtIdentityGuard } from '../../auth/guards/jwt-identity.guard';
import { extractBearerToken } from '../../../common/utils/token.util';
import type { GuestAwareRequest } from '../guest-request';
import { GuestService } from '../guest.service';

/**
 * Gates the public browsing endpoints (Tasker discovery, Services catalogue)
 * that used to accept fully anonymous requests. Accepts either:
 *  - a guest token issued by POST /guest/token (attaches request.guest), or
 *  - a normal Customer/Tasker/Admin bearer JWT, verified through the existing
 *    JwtIdentityGuard so an already-authenticated caller is never forced to
 *    also fetch a guest token.
 * A request with neither is rejected; a guest token can never satisfy this
 * guard as a User identity, and a User JWT is never treated as a guest token.
 */
@Injectable()
export class GuestOrIdentityGuard implements CanActivate {
  constructor(
    private readonly guests: GuestService,
    private readonly identityGuard: JwtIdentityGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuestAwareRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTHENTICATION_REQUIRED',
        message: 'A guest token or an authenticated session is required.',
      });
    }

    if (GuestService.looksLikeGuestToken(token)) {
      request.guest = await this.guests.validateAndTouch(token);
      return true;
    }

    return this.identityGuard.canActivate(context) as Promise<boolean>;
  }
}
