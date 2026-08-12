import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request';
import { JwtIdentityGuard } from './jwt-identity.guard';

/** Requires a valid active session and a verified email address. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly identityGuard: JwtIdentityGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.identityGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user.isVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email before accessing this resource',
        userVerified: false,
      });
    }
    return true;
  }
}
