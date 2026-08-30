import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ADMINISTRATIVE_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request';
import { JwtAuthGuard } from './jwt-auth.guard';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly jwtGuard: JwtAuthGuard) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    await this.jwtGuard.canActivate(context);
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!ADMINISTRATIVE_ROLES.includes(request.auth.role as UserRole)) {
      throw new ForbiddenException('Administrator access is required');
    }
    if (request.user.mustChangePassword) {
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Change the temporary administrator password before accessing Admin APIs.',
        action: 'PATCH /api/auth/change-password',
      });
    }
    return true;
  }
}
