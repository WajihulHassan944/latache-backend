import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { AuthenticatedRequest } from '../../../common/types/authenticated-request';
import type { AccessTokenPayload } from '../../../common/types/jwt-payload';
import { extractAccessToken } from '../../../common/utils/token.util';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractAccessToken(
      request,
      this.config.get<boolean>('app.allowQueryTokenCompatibility', false),
    );
    if (!token) throw new UnauthorizedException('Token is required');

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('auth.jwtSecret'),
      });
      const userId = Number(payload.sub ?? payload.id);
      if (!Number.isSafeInteger(userId) || userId < 1) {
        throw new UnauthorizedException('Token is invalid');
      }
      const user = await this.users.findById(userId);
      if (!user) throw new UnauthorizedException('Token is invalid');
      if (!user.isVerified) {
        throw new UnauthorizedException('Email is not verified');
      }
      request.user = user;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Token is invalid');
    }
  }
}
