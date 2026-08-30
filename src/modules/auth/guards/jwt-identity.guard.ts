import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { ADMINISTRATIVE_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request';
import type { AccessTokenPayload } from '../../../common/types/jwt-payload';
import { extractBearerToken } from '../../../common/utils/token.util';
import { UsersService } from '../../users/users.service';
import { AuthSessionsRepository } from '../repositories/auth-sessions.repository';
import { AuthRoleService } from '../services/auth-role.service';

/**
 * Resolves a bearer token to an active database user and active refresh-token
 * session. It intentionally allows an unverified account so registration can
 * finish through POST /auth/verify-email.
 */
@Injectable()
export class JwtIdentityGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly sessions: AuthSessionsRepository,
    private readonly roles: AuthRoleService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractBearerToken(request.headers.authorization);
    if (!token) throw new UnauthorizedException('Bearer token is required');

    const payload = await this.verifyWithConfiguredSecrets(token);
    const userId = Number(payload.sub ?? payload.id);
    const sessionId = Number(payload.sessionId);
    if (
      !Number.isSafeInteger(userId) ||
      userId < 1 ||
      !Number.isSafeInteger(sessionId) ||
      sessionId < 1
    ) {
      throw new UnauthorizedException('Token is invalid');
    }

    const [user, session] = await Promise.all([
      this.users.findById(userId),
      this.sessions.findActiveById(sessionId, userId),
    ]);

    if (!user || user.deletedAt || !session) {
      throw new UnauthorizedException('Session is invalid or expired');
    }
    if (session.activeRole && session.activeRole !== payload.role) {
      throw new UnauthorizedException('Session role does not match this access token');
    }
    if (user.accountStatus === AccountStatus.Suspended) {
      throw new ForbiddenException('Account is suspended');
    }
    if (user.accountStatus === AccountStatus.Deactivated) {
      throw new ForbiddenException('Account is deactivated');
    }

    await this.roles.assertSelectable(user, payload.role);

    // Keep legacy service/controller code role-aware without duplicating the
    // User identity: request.user.role is the role selected by this JWT, while
    // the persisted User.role remains the primary/backward-compatible role.
    request.user = { ...user, role: payload.role };
    request.auth = payload;
    return true;
  }

  private async verifyWithConfiguredSecrets(token: string): Promise<AccessTokenPayload> {
    const decoded = this.jwt.decode<Partial<AccessTokenPayload>>(token);
    const role = decoded?.role;
    if (!role || !Object.values(UserRole).includes(role as UserRole)) {
      throw new UnauthorizedException('Token is invalid or expired');
    }

    const administrative = ADMINISTRATIVE_ROLES.includes(role as UserRole);
    const secret = administrative
      ? this.config.get<string>('auth.adminJwtSecret')
      : this.config.get<string>('auth.jwtSecret');
    if (!secret) throw new UnauthorizedException('Token is invalid or expired');

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret });
      if (payload.role !== role || payload.isAdmin !== administrative) {
        throw new UnauthorizedException('Token role boundary is invalid');
      }
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Token is invalid or expired');
    }
  }
}
