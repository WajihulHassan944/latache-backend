import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { ADMINISTRATIVE_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import type { AccessTokenPayload } from '../../../common/types/jwt-payload';
import { generateOpaqueToken, hashOpaqueToken } from '../../../common/utils/crypto.util';
import { hasUserRole, userRoles } from '../../../common/utils/user-role.util';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma, User } from '../../../generated/prisma/client';
import { AuthRepository } from '../repositories/auth.repository';
import { AuthSessionsRepository } from '../repositories/auth-sessions.repository';

export interface SessionMetadata {
  device?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
}

@Injectable()
export class AuthTokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly users: AuthRepository,
    private readonly sessions: AuthSessionsRepository,
  ) {}

  async issue(
    user: User,
    metadata: SessionMetadata = {},
    transaction?: Prisma.TransactionClient,
    activeRole?: UserRole,
  ): Promise<AuthTokens> {
    const selectedRole = activeRole ?? (user.role as UserRole);
    if (!hasUserRole(user, selectedRole)) {
      throw new UnauthorizedException('Selected role is not enabled for this account');
    }
    const refreshToken = generateOpaqueToken();
    const session = await this.sessions.create(
      {
        userId: user.id,
        tokenHash: hashOpaqueToken(refreshToken),
        device: metadata.device ?? null,
        ipAddress: metadata.ipAddress?.slice(0, 64) ?? null,
        userAgent: metadata.userAgent?.slice(0, 512) ?? null,
        activeRole: selectedRole,
        lastUsedAt: new Date(),
        expiresAt: this.refreshExpiry(),
      },
      transaction,
    );

    return {
      accessToken: await this.signAccessToken(user, session.id, selectedRole),
      refreshToken,
      tokenType: 'Bearer',
    };
  }

  async refresh(refreshToken: string, metadata: SessionMetadata = {}): Promise<AuthTokens> {
    const tokenHash = hashOpaqueToken(refreshToken);

    const outcome = await this.prisma.$transaction(
      async (transaction: Prisma.TransactionClient) => {
        const stored = await this.sessions.lockByHash(tokenHash, transaction);
        if (!stored) return { kind: 'invalid' as const };

        if (stored.revokedAt) {
          await this.sessions.revokeAll(stored.userId, transaction);
          return { kind: 'reused' as const };
        }
        if (stored.expiresAt.getTime() <= Date.now()) {
          await transaction.refreshToken.update({
            where: { id: stored.id },
            data: { revokedAt: new Date() },
          });
          return { kind: 'expired' as const };
        }

        const user = await this.users.findUserByIdForUpdate(stored.userId, transaction);
        if (!user || !this.canUseTokens(user)) {
          if (user) await this.sessions.revokeAll(user.id, transaction);
          return { kind: 'account' as const };
        }

        const replacement = generateOpaqueToken();
        const replacementHash = hashOpaqueToken(replacement);
        const replacementSession = await this.sessions.create(
          {
            userId: user.id,
            tokenHash: replacementHash,
            device: metadata.device ?? stored.device,
            ipAddress: metadata.ipAddress?.slice(0, 64) ?? stored.ipAddress,
            userAgent: metadata.userAgent?.slice(0, 512) ?? stored.userAgent,
            activeRole: this.resolveRefreshRole(user, stored.activeRole),
            lastUsedAt: new Date(),
            expiresAt: this.refreshExpiry(),
          },
          transaction,
        );

        await transaction.refreshToken.update({
          where: { id: stored.id },
          data: {
            revokedAt: new Date(),
            replacedByTokenHash: replacementHash,
            lastUsedAt: new Date(),
          },
        });

        return {
          kind: 'success' as const,
          tokens: {
            accessToken: await this.signAccessToken(
              user,
              replacementSession.id,
              this.resolveRefreshRole(user, replacementSession.activeRole),
            ),
            refreshToken: replacement,
            tokenType: 'Bearer' as const,
          },
        };
      },
    );

    if (outcome.kind === 'invalid') throw new UnauthorizedException('Refresh token is invalid');
    if (outcome.kind === 'reused') throw new UnauthorizedException('Refresh token reuse detected');
    if (outcome.kind === 'expired') throw new UnauthorizedException('Refresh token has expired');
    if (outcome.kind === 'account')
      throw new UnauthorizedException('Account cannot use this session');
    return outcome.tokens;
  }

  private canUseTokens(user: User): boolean {
    // Registration sessions must remain refreshable while the account is
    // pending email verification; otherwise a user whose short-lived access
    // token expires cannot complete POST /auth/verify-email.
    return Boolean(
      !user.deletedAt &&
        user.accountStatus !== AccountStatus.Suspended &&
        user.accountStatus !== AccountStatus.Deactivated,
    );
  }

  private signAccessToken(user: User, sessionId: number, role: UserRole): Promise<string> {
    if (!hasUserRole(user, role)) {
      throw new UnauthorizedException('Selected role is no longer enabled for this account');
    }
    const payload: AccessTokenPayload = {
      sub: user.id,
      id: user.id,
      role,
      roles: userRoles(user),
      permissions: user.permissions,
      sessionId,
      isVerified: user.isVerified,
      isAdmin: ADMINISTRATIVE_ROLES.includes(role),
    };

    return this.jwt.signAsync(payload, {
      secret: this.accessSecret(role),
      expiresIn: this.config.get<string>(
        'auth.accessTokenExpiresIn',
        '15m',
      ) as JwtSignOptions['expiresIn'],
    });
  }

  private resolveRefreshRole(user: User, storedRole: string | null): UserRole {
    const candidate = (storedRole || user.role) as UserRole;
    if (!hasUserRole(user, candidate)) {
      throw new UnauthorizedException('Session role is no longer enabled for this account');
    }
    return candidate;
  }

  private accessSecret(role: UserRole): string {
    if (ADMINISTRATIVE_ROLES.includes(role)) {
      return (
        this.config.get<string>('auth.adminJwtSecret') ??
        this.config.getOrThrow<string>('auth.jwtSecret')
      );
    }
    return this.config.getOrThrow<string>('auth.jwtSecret');
  }

  private refreshExpiry(): Date {
    const days = this.config.get<number>('auth.refreshTokenExpiresInDays', 30);
    return new Date(Date.now() + days * 86_400_000);
  }
}
