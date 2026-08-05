import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { ADMINISTRATIVE_ROLES, UserRole } from '../../../common/enums/user-role.enum';
import type { AccessTokenPayload } from '../../../common/types/jwt-payload';
import { generateOpaqueToken, hashOpaqueToken } from '../../../common/utils/crypto.util';
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
  ): Promise<AuthTokens> {
    const refreshToken = generateOpaqueToken();
    const session = await this.sessions.create(
      {
        userId: user.id,
        tokenHash: hashOpaqueToken(refreshToken),
        device: metadata.device ?? null,
        ipAddress: metadata.ipAddress?.slice(0, 64) ?? null,
        userAgent: metadata.userAgent?.slice(0, 512) ?? null,
        lastUsedAt: new Date(),
        expiresAt: this.refreshExpiry(),
      },
      transaction,
    );

    return {
      accessToken: await this.signAccessToken(user, session.id),
      refreshToken,
      tokenType: 'Bearer',
    };
  }

  async refresh(refreshToken: string, metadata: SessionMetadata = {}): Promise<AuthTokens> {
    const tokenHash = hashOpaqueToken(refreshToken);

    const outcome = await this.prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
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
          accessToken: await this.signAccessToken(user, replacementSession.id),
          refreshToken: replacement,
          tokenType: 'Bearer' as const,
        },
      };
    });

    if (outcome.kind === 'invalid') throw new UnauthorizedException('Refresh token is invalid');
    if (outcome.kind === 'reused') throw new UnauthorizedException('Refresh token reuse detected');
    if (outcome.kind === 'expired') throw new UnauthorizedException('Refresh token has expired');
    if (outcome.kind === 'account') throw new UnauthorizedException('Account cannot use this session');
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

  private signAccessToken(user: User, sessionId: number): Promise<string> {
    const role = user.role as UserRole;
    const payload: AccessTokenPayload = {
      sub: user.id,
      id: user.id,
      role,
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

  private accessSecret(role: UserRole): string {
    if (ADMINISTRATIVE_ROLES.includes(role)) {
      return this.config.get<string>('auth.adminJwtSecret') ??
        this.config.getOrThrow<string>('auth.jwtSecret');
    }
    return this.config.getOrThrow<string>('auth.jwtSecret');
  }

  private refreshExpiry(): Date {
    const days = this.config.get<number>('auth.refreshTokenExpiresInDays', 30);
    return new Date(Date.now() + days * 86_400_000);
  }
}
