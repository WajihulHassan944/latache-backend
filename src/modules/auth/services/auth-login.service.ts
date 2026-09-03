import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { ADMINISTRATIVE_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import { serializeUser, type PublicUser } from '../../../common/utils/user.util';
import type { Prisma } from '../../../generated/prisma/client';
import { success, type SuccessEnvelope } from '../auth-response';
import type { LoginDto, RefreshTokenDto } from '../dto';
import { AuthRepository } from '../repositories/auth.repository';
import { AuthLockoutService } from './auth-lockout.service';
import { AuthRoleService } from './auth-role.service';
import { AuthTokenService, type AuthTokens, type SessionMetadata } from './auth-token.service';

@Injectable()
export class AuthLoginService {
  private dummyPasswordHash?: Promise<string>;

  constructor(
    private readonly repository: AuthRepository,
    private readonly tokens: AuthTokenService,
    private readonly roles: AuthRoleService,
    private readonly config: ConfigService,
    private readonly lockout: AuthLockoutService,
  ) {}

  async login(
    dto: LoginDto,
    metadata: SessionMetadata,
  ): Promise<SuccessEnvelope<{ user: PublicUser; tokens: AuthTokens }>> {
    const user = await this.repository.findUserByEmail(dto.email);
    // Always run one bcrypt compare - against the real hash, or a dummy one of
    // the same cost when the account/password doesn't exist - so response
    // timing cannot be used to tell whether an email is registered.
    const passwordMatches = await compare(
      dto.password,
      user?.password ?? (await this.getDummyPasswordHash()),
    );

    if (!user?.password || this.lockout.isLocked(user)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    if (!passwordMatches) {
      await this.lockout.recordFailedAttempt(user.id);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.deletedAt || user.accountStatus === AccountStatus.Deactivated) {
      throw new ForbiddenException('This account is deactivated');
    }
    if (user.accountStatus === AccountStatus.Suspended) {
      throw new ForbiddenException('This account is suspended');
    }
    if (!user.isVerified) {
      throw new ForbiddenException({
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Verify your email before login',
        userVerified: false,
      });
    }

    const selectedRole = this.resolveSelectedRole(user, dto);
    await this.roles.assertSelectable(user, selectedRole);

    const tokens = await this.tokens.issue(user, metadata, undefined, selectedRole);
    const updated = await this.repository.updateUser(user.id, {
      lastLoginAt: new Date(),
      loginFailedAttempts: 0,
      loginLockedUntil: null,
      lastFailedLoginAt: null,
    });
    return success(
      { user: serializeUser(updated, selectedRole), tokens },
      updated.mustChangePassword
        ? 'Login successful. Change the temporary password before continuing.'
        : 'Login successful.',
    );
  }

  private resolveSelectedRole(user: Parameters<AuthRoleService['roles']>[0], dto: LoginDto): UserRole {
    if (dto.role && dto.expectedRole && dto.role !== dto.expectedRole) {
      throw new BadRequestException('role and expectedRole must match when both are provided');
    }

    const requested = dto.role ?? dto.expectedRole;
    const available = this.roles.roles(user);
    if (requested) {
      if (
        requested === UserRole.Admin &&
        !available.includes(UserRole.Admin) &&
        available.includes(UserRole.SuperAdmin)
      ) {
        return UserRole.SuperAdmin;
      }
      if (!available.includes(requested)) {
        throw new ForbiddenException({
          code: 'ROLE_NOT_ENABLED',
          message: 'This account cannot access the selected portal.',
          availableRoles: available,
        });
      }
      return requested;
    }

    const marketplace = available.filter(
      (role) => role === UserRole.Customer || role === UserRole.Tasker,
    );
    if (marketplace.length > 1) {
      throw new BadRequestException({
        code: 'ROLE_SELECTION_REQUIRED',
        message: 'Select the role to use for this login.',
        availableRoles: available,
      });
    }

    if (available.length === 1) return available[0]!;
    const primary = user.role as UserRole;
    if (available.includes(primary)) return primary;
    const administrative = available.find((role) => ADMINISTRATIVE_ROLES.includes(role));
    if (administrative) return administrative;
    throw new ForbiddenException('This account has no usable role');
  }

  async switchRole(
    userId: number,
    currentSessionId: number,
    role: UserRole,
    metadata: SessionMetadata,
  ): Promise<SuccessEnvelope<{ user: PublicUser; tokens: AuthTokens }>> {
    if (role !== UserRole.Customer && role !== UserRole.Tasker) {
      throw new ForbiddenException('Only Customer and Tasker marketplace roles can be switched here');
    }
    const result = await this.repository.transaction(async (transaction: Prisma.TransactionClient) => {
      const user = await this.repository.findUserByIdForUpdate(userId, transaction);
      if (!user || user.deletedAt) throw new UnauthorizedException('Account not found');
      await this.roles.assertSelectable(user, role, transaction);
      await transaction.refreshToken.updateMany({
        where: { id: currentSessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const tokens = await this.tokens.issue(user, metadata, transaction, role);
      return { user, tokens };
    });
    return success(
      { user: serializeUser(result.user, role), tokens: result.tokens },
      `Switched to ${role} role successfully.`,
    );
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

  /** Memoized per-instance so repeated failed logins don't re-hash on every request. */
  private getDummyPasswordHash(): Promise<string> {
    if (!this.dummyPasswordHash) {
      const rounds = this.config.get<number>('auth.bcryptRounds', 12);
      this.dummyPasswordHash = hash('latache-timing-safety-dummy-password', rounds);
    }
    return this.dummyPasswordHash;
  }
}
