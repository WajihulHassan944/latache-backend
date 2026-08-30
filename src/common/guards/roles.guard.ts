import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest } from '../types/authenticated-request';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserRole } from '../enums/user-role.enum';
import { AuthRoleService } from '../../modules/auth/services/auth-role.service';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly roleAccess: AuthRoleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const activeRole = request.auth?.role as UserRole | undefined;
    if (!request.user || !activeRole || !requiredRoles.includes(activeRole)) {
      throw new ForbiddenException('Your account role cannot access this resource');
    }

    // A route dedicated to one marketplace role is operational, not merely an
    // onboarding/status surface. Pending/rejected/suspended/deactivated profiles
    // may authenticate, but cannot consume role-specific marketplace APIs.
    if (requiredRoles.length === 1) {
      await this.roleAccess.assertOperational(request.user, activeRole);
    }
    return true;
  }
}
