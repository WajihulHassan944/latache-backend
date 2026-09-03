import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma, User } from '../../../generated/prisma/client';
import { AuthRepository } from '../repositories/auth.repository';

/**
 * Shared local-login brute-force protection. Any code path that verifies a
 * User's stored password (POST /auth/login, and the existing-verified-identity
 * check inside customer/tasker registration) must go through the same
 * lockout check and failed-attempt bookkeeping here, otherwise it becomes an
 * unthrottled side door around the lockout that the other path enforces.
 */
@Injectable()
export class AuthLockoutService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly config: ConfigService,
  ) {}

  isLocked(user: Pick<User, 'loginLockedUntil'>): boolean {
    return Boolean(user.loginLockedUntil && user.loginLockedUntil.getTime() > Date.now());
  }

  async recordFailedAttempt(userId: number): Promise<void> {
    const maxAttempts = this.config.get<number>('auth.maxFailedLoginAttempts', 5);
    const lockMinutes = this.config.get<number>('auth.loginLockMinutes', 15);
    const now = new Date();
    const failureWindowStart = now.getTime() - lockMinutes * 60_000;

    await this.repository.transaction(async (transaction: Prisma.TransactionClient) => {
      const user = await this.repository.findUserByIdForUpdate(userId, transaction);
      if (!user || user.deletedAt) return;

      const recentFailure =
        user.lastFailedLoginAt && user.lastFailedLoginAt.getTime() >= failureWindowStart;
      const currentLockActive =
        user.loginLockedUntil && user.loginLockedUntil.getTime() > now.getTime();
      const attempts = (recentFailure && !currentLockActive ? user.loginFailedAttempts : 0) + 1;
      const shouldLock = attempts >= maxAttempts;

      await transaction.user.update({
        where: { id: user.id },
        data: {
          loginFailedAttempts: attempts,
          lastFailedLoginAt: now,
          loginLockedUntil: shouldLock ? new Date(now.getTime() + lockMinutes * 60_000) : null,
        },
      });
    });
  }
}
