import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { extractBearerToken } from '../../../common/utils/token.util';
import type { GuestAwareRequest } from '../guest-request';
import { GuestService } from '../guest.service';

/**
 * Gates guest-only self-service actions (currently: saving the guest
 * session's location) that make no sense for an authenticated identity - a
 * Customer/Tasker/Admin saves their location through their own account
 * instead. Unlike GuestOrIdentityGuard, a normal bearer JWT never satisfies
 * this guard.
 */
@Injectable()
export class GuestOnlyGuard implements CanActivate {
  constructor(private readonly guests: GuestService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<GuestAwareRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token || !GuestService.looksLikeGuestToken(token)) {
      throw new UnauthorizedException({
        code: 'GUEST_TOKEN_REQUIRED',
        message: 'A guest token is required.',
      });
    }

    request.guest = await this.guests.validateAndTouch(token);
    return true;
  }
}
