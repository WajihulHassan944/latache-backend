import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Prisma, User } from '../../../generated/prisma/client';
import { UserRole } from '../../../common/enums/user-role.enum';
import { hasUserRole, userRoles } from '../../../common/utils/user-role.util';
import { PrismaService } from '../../../database/prisma.service';

export const MARKETPLACE_PROFILE_STATUS = {
  Active: 'active',
  PendingApproval: 'pending_approval',
  Rejected: 'rejected',
  Suspended: 'suspended',
  Deactivated: 'deactivated',
} as const;

@Injectable()
export class AuthRoleService {
  constructor(private readonly prisma: PrismaService) {}

  roles(user: User): UserRole[] {
    return userRoles(user);
  }

  has(user: User, role: UserRole): boolean {
    return hasUserRole(user, role);
  }

  async assertSelectable(
    user: User,
    role: UserRole,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!this.has(user, role)) {
      throw new ForbiddenException({
        code: 'ROLE_NOT_ENABLED',
        message: 'This role is not enabled for the account.',
        availableRoles: this.roles(user),
      });
    }

    const db = transaction ?? this.prisma;
    if (role === UserRole.Customer) {
      const profile = await db.customerProfile.findUnique({ where: { userId: user.id } });
      if (!profile) {
        throw new ForbiddenException({
          code: 'CUSTOMER_PROFILE_MISSING',
          message: 'Customer access is not configured for this identity.',
        });
      }
      if ([MARKETPLACE_PROFILE_STATUS.Suspended, MARKETPLACE_PROFILE_STATUS.Deactivated].includes(
        profile.status as 'suspended' | 'deactivated',
      )) {
        throw new ForbiddenException({
          code: 'CUSTOMER_PROFILE_INACTIVE',
          message: `Customer access is ${profile.status}.`,
        });
      }
      return;
    }

    if (role === UserRole.Tasker) {
      const profile = await db.taskerProfile.findUnique({ where: { userId: user.id } });
      if (!profile) {
        throw new ForbiddenException({
          code: 'TASKER_PROFILE_MISSING',
          message: 'Tasker access is not configured for this identity.',
        });
      }
      if ([MARKETPLACE_PROFILE_STATUS.Suspended, MARKETPLACE_PROFILE_STATUS.Deactivated].includes(
        profile.status as 'suspended' | 'deactivated',
      )) {
        throw new ForbiddenException({
          code: 'TASKER_PROFILE_INACTIVE',
          message: `Tasker access is ${profile.status}.`,
        });
      }
    }
  }

  async profileStates(userId: number) {
    const [customer, tasker] = await Promise.all([
      this.prisma.customerProfile.findUnique({ where: { userId } }),
      this.prisma.taskerProfile.findUnique({ where: { userId } }),
    ]);
    return {
      customer: customer
        ? {
            status: customer.status,
            activatedAt: customer.activatedAt,
            suspendedAt: customer.suspendedAt,
            deactivatedAt: customer.deactivatedAt,
            rating: Number(customer.rating),
            reviewsCount: customer.reviewsCount,
            disciplinaryState: customer.disciplinaryState,
          }
        : null,
      tasker: tasker
        ? {
            status: tasker.status,
            approvedAt: tasker.approvedAt,
            rejectedAt: tasker.rejectedAt,
            suspendedAt: tasker.suspendedAt,
            deactivatedAt: tasker.deactivatedAt,
            rating: Number(tasker.rating),
            reviewsCount: tasker.reviewsCount,
            disciplinaryState: tasker.disciplinaryState,
          }
        : null,
    };
  }
}
