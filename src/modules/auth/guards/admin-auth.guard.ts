import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request';
import type { AccessTokenPayload } from '../../../common/types/jwt-payload';
import { UserRole } from '../../../common/enums/user-role.enum';
import { extractAccessToken } from '../../../common/utils/token.util';
import { UsersService } from '../../users/users.service';

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractAccessToken(request, false);
    if (!token) throw new UnauthorizedException('Token is required');

    const secrets = [
      this.config.get<string>('auth.adminJwtSecret'),
      this.config.get<string>('auth.jwtSecret'),
    ].filter((secret): secret is string => Boolean(secret));

    let payload: AccessTokenPayload | null = null;
    for (const secret of secrets) {
      try {
        payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret });
        break;
      } catch {
        // Try the next configured admin-compatible key.
      }
    }
    if (!payload) throw new UnauthorizedException('Token is invalid');

    const userId = Number(payload.sub ?? payload.id);
    const user = Number.isSafeInteger(userId) ? await this.users.findById(userId) : null;
    if (!user) throw new UnauthorizedException('Token is invalid');
    if (!user.isVerified) throw new UnauthorizedException('Email is not verified');
    if (user.role !== UserRole.Admin && !user.isAdmin) {
      throw new ForbiddenException('Administrator access is required');
    }
    request.user = user;
    return true;
  }
}
