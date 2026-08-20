import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums/user-role.enum';
import type { AuthenticatedRequest } from '../types/authenticated-request';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      throw new ForbiddenException('Authenticated account context is required');
    }
    if (request.auth.role === UserRole.SuperAdmin) return true;

    const available = new Set(request.user.permissions);
    const missing = requiredPermissions.filter((permission) => !available.has(permission));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required permission${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}`,
      );
    }
    return true;
  }
}
