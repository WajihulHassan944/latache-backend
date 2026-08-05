import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { compare } from 'bcryptjs';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { serializeUser, type PublicUser } from '../../../common/utils/user.util';
import { success, type SuccessEnvelope } from '../auth-response';
import type { LoginDto, RefreshTokenDto } from '../dto';
import { AuthRepository } from '../repositories/auth.repository';
import { AuthTokenService, type AuthTokens, type SessionMetadata } from './auth-token.service';

@Injectable()
export class AuthLoginService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: AuthTokenService,
  ) {}

  async login(
    dto: LoginDto,
    metadata: SessionMetadata,
  ): Promise<SuccessEnvelope<{ user: PublicUser; tokens: AuthTokens }>> {
    const user = await this.repository.findUserByEmail(dto.email);
    if (!user?.password || !(await compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (user.deletedAt || user.accountStatus === AccountStatus.Deactivated) {
      throw new ForbiddenException('This account is deactivated');
    }
    if (user.accountStatus === AccountStatus.Suspended) {
      throw new ForbiddenException('This account is suspended');
    }
    if (
      dto.expectedRole &&
      !this.matchesExpectedRole(user.role as UserRole, dto.expectedRole)
    ) {
      throw new ForbiddenException('This account cannot access the selected portal');
    }
    if (!user.isVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email before login',
        userVerified: false,
      });
    }

    const tokens = await this.tokens.issue(user, metadata);
    const updated = await this.repository.updateUser(user.id, { lastLoginAt: new Date() });
    return success(
      { user: serializeUser(updated), tokens },
      updated.mustChangePassword
        ? 'Login successful. Change the temporary password before continuing.'
        : 'Login successful.',
    );
  }

  private matchesExpectedRole(
    actualRole: UserRole,
    expectedRole: UserRole,
  ): boolean {
    if (expectedRole === UserRole.Admin) {
      return actualRole === UserRole.Admin || actualRole === UserRole.SuperAdmin;
    }
    return actualRole === expectedRole;
  }

  async refresh(
    dto: RefreshTokenDto,
    metadata: SessionMetadata,
  ): Promise<SuccessEnvelope<AuthTokens>> {
    return success(
      await this.tokens.refresh(dto.refreshToken, metadata),
      'Token refreshed successfully.',
    );
  }
}
