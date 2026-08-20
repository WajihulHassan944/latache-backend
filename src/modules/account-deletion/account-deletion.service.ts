import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { ObjectStorageDeletionService } from './object-storage-deletion.service';
import { AppCacheService, CacheNamespace } from '../../infrastructure/redis/app-cache.service';

export interface DeletionBlocker {
  resource: string;
  count: number;
  reason: string;
}

@Injectable()
export class AccountDeletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly storage: ObjectStorageDeletionService,
    private readonly cache: AppCacheService,
  ) {}

  async permanentlyDelete(actor: User, userId: number, expectedRole: UserRole, reason: string) {
    if (actor.id === userId) {
      throw new ForbiddenException({
        code: 'SELF_DELETION_FORBIDDEN',
        message: 'Administrators cannot permanently delete their own account.',
      });
    }
    const user = await this.prisma.user.findFirst({
      where: { id: userId, roles: { has: expectedRole }, deletedAt: null },
      include: {
        supportTickets: {
          select: {
            requesterRole: true,
            attachments: true,
            messages: { select: { attachments: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException(`${this.roleLabel(expectedRole)} not found`);
    if (user.role === UserRole.SuperAdmin) {
      throw new ForbiddenException({
        code: 'SUPER_ADMIN_DELETION_FORBIDDEN',
        message: 'The canonical Super Admin account cannot be deleted.',
      });
    }

    const blockers = await this.blockers(userId, expectedRole);
    if (blockers.length > 0) {
      throw new ConflictException({
        code: 'ACCOUNT_PURGE_BLOCKED',
        message:
          'This account owns protected operational or financial records and cannot be permanently deleted.',
        blockers,
      });
    }

    const marketplaceRoles = user.roles.filter((role) =>
      role === UserRole.Customer || role === UserRole.Tasker,
    );
    if (
      (expectedRole === UserRole.Customer || expectedRole === UserRole.Tasker) &&
      marketplaceRoles.length > 1
    ) {
      return this.removeMarketplaceRole(actor, user, expectedRole, reason);
    }

    const assets = this.storage.extractManagedAssets(
      user.profilePicture,
      user.identityDocument,
      user.workImages,
      user.supportTickets,
    );
    const entityType = expectedRole === UserRole.Admin ? 'administrator' : expectedRole;
    const queued = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: number; role: string; roles: string[] }>>(Prisma.sql`
        SELECT "id", "role", "roles" FROM "Users" WHERE "id" = ${userId} FOR UPDATE
      `);
      if (!locked[0]?.roles?.includes(expectedRole)) {
        throw new NotFoundException(`${this.roleLabel(expectedRole)} not found`);
      }
      const rechecked = await this.blockers(userId, expectedRole, tx);
      if (rechecked.length > 0) {
        throw new ConflictException({
          code: 'ACCOUNT_PURGE_BLOCKED',
          message: 'Protected records were added while deletion was being prepared.',
          blockers: rechecked,
        });
      }

      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: userId,
          action: 'account_permanently_deleted',
          entityType,
          entityId: userId,
          reason,
          metadata: {
            deletedRole: expectedRole,
            assetCount: assets.length,
            irreversible: true,
          },
        },
        tx,
      );
      const taskCount = await this.storage.enqueue(tx, assets, entityType, userId, actor.id);

      await tx.supportTicketMessage.deleteMany({ where: { senderId: userId } });
      await tx.supportTicket.deleteMany({ where: { userId } });
      await tx.eliteTaskerBadge.deleteMany({ where: { taskerId: userId } });
      await tx.eliteTierTransition.deleteMany({ where: { taskerId: userId } });
      await tx.eliteMembershipRequest.deleteMany({ where: { taskerId: userId } });
      await tx.taskerPayoutMethod.deleteMany({ where: { taskerId: userId } });
      await tx.taskerWallet.deleteMany({ where: { taskerId: userId } });
      await tx.taskerPlatformAccount.deleteMany({ where: { taskerId: userId } });
      await tx.customerWallet.deleteMany({ where: { customerId: userId } });
      await tx.realtimeOutboxEvent.deleteMany({ where: { room: `user:${userId}` } });
      await tx.user.delete({ where: { id: userId } });
      return taskCount;
    });

    const assetCleanup = await this.storage.attemptImmediate(entityType, userId, queued);
    await Promise.all([
      this.cache.invalidate(CacheNamespace.AdminAnalytics),
      ...(expectedRole === UserRole.Tasker
        ? [this.cache.invalidate(CacheNamespace.EliteProgram)]
        : []),
    ]);
    return {
      success: true,
      data: {
        id: String(userId),
        role: expectedRole,
        deleted: true,
        irreversible: true,
        assetCleanup,
      },
      message: `${this.roleLabel(expectedRole)} permanently deleted.`,
    };
  }

  private async removeMarketplaceRole(
    actor: User,
    user: User & {
      supportTickets: Array<{
        requesterRole: string;
        attachments: Prisma.JsonValue;
        messages: Array<{ attachments: Prisma.JsonValue }>;
      }>;
    },
    role: UserRole.Customer | UserRole.Tasker,
    reason: string,
  ) {
    const roleSupportTickets = user.supportTickets.filter((ticket) => ticket.requesterRole === role);
    const assets = this.storage.extractManagedAssets(
      null,
      role === UserRole.Tasker ? user.identityDocument : null,
      role === UserRole.Tasker ? user.workImages : [],
      roleSupportTickets,
    );
    const entityType = role;
    const blockers = await this.blockers(user.id, role);
    if (blockers.length > 0) {
      throw new ConflictException({
        code: 'ACCOUNT_ROLE_PURGE_BLOCKED',
        message: `This ${this.roleLabel(role)} profile owns protected records and cannot be removed.`,
        blockers,
      });
    }

    const queued = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ id: number; role: string; roles: string[] }>>(Prisma.sql`
        SELECT "id", "role", "roles" FROM "Users" WHERE "id" = ${user.id} FOR UPDATE
      `);
      if (!locked?.roles?.includes(role)) throw new NotFoundException(`${this.roleLabel(role)} not found`);
      const remainingRoles = locked.roles.filter((value) => value !== role);
      if (remainingRoles.length === 0) throw new ConflictException('Cannot remove the final identity role through profile removal');
      const rechecked = await this.blockers(user.id, role, tx);
      if (rechecked.length > 0) {
        throw new ConflictException({
          code: 'ACCOUNT_ROLE_PURGE_BLOCKED',
          message: 'Protected records were added while profile removal was being prepared.',
          blockers: rechecked,
        });
      }

      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: user.id,
          action: 'account_role_permanently_deleted',
          entityType,
          entityId: user.id,
          reason,
          metadata: { deletedRole: role, remainingRoles, assetCount: assets.length, irreversible: true },
        },
        tx,
      );
      const taskCount = await this.storage.enqueue(tx, assets, entityType, user.id, actor.id);

      await tx.refreshToken.updateMany({
        where: { userId: user.id, activeRole: role, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.supportTicket.deleteMany({ where: { userId: user.id, requesterRole: role } });

      if (role === UserRole.Customer) {
        await tx.favoriteTasker.deleteMany({ where: { customerId: user.id } });
        await tx.customerWallet.deleteMany({ where: { customerId: user.id } });
        await tx.customerProfile.delete({ where: { userId: user.id } });
        await tx.user.update({
          where: { id: user.id },
          data: {
            stripeCustomerId: null,
            defaultStripePaymentMethodId: null,
            roles: remainingRoles,
            ...(locked.role === role ? { role: remainingRoles[0] } : {}),
          },
        });
      } else {
        await tx.userAvailability.deleteMany({ where: { userId: user.id } });
        await tx.userService.deleteMany({ where: { userId: user.id } });
        await tx.eliteTaskerBadge.deleteMany({ where: { taskerId: user.id } });
        await tx.eliteEvaluation.deleteMany({ where: { taskerId: user.id } });
        await tx.eliteTierTransition.deleteMany({ where: { taskerId: user.id } });
        await tx.eliteMembershipRequest.deleteMany({ where: { taskerId: user.id } });
        await tx.taskerPayoutMethod.deleteMany({ where: { taskerId: user.id } });
        await tx.taskerWallet.deleteMany({ where: { taskerId: user.id } });
        await tx.taskerPlatformAccount.deleteMany({ where: { taskerId: user.id } });
        const retainedCustomerProfile = remainingRoles.includes(UserRole.Customer)
          ? await tx.customerProfile.findUnique({
              where: { userId: user.id },
              select: { rating: true, reviewsCount: true },
            })
          : null;
        await tx.taskerProfile.delete({ where: { userId: user.id } });
        await tx.user.update({
          where: { id: user.id },
          data: {
            roles: remainingRoles,
            ...(locked.role === role ? { role: remainingRoles[0] } : {}),
            bio: null,
            isProfilePublic: false,
            isDocVerified: false,
            yearsOfExperience: null,
            hourlyRate: null,
            idType: null,
            identityDocument: Prisma.DbNull,
            serviceAreaLabel: null,
            serviceAreaLat: null,
            serviceAreaLng: null,
            serviceAreaRadiusKm: null,
            serviceAreaCity: null,
            serviceAreaArea: null,
            onboardingStatus: null,
            submittedAt: null,
            vehicles: [],
            workImages: [],
            isElite: false,
            eliteTierId: null,
            eliteSince: null,
            eliteAtRiskSince: null,
            eliteGraceUntil: null,
            eliteLastEvaluatedAt: null,
            aboutMe: null,
            skills: [],
            ...(retainedCustomerProfile
              ? {
                  rating: retainedCustomerProfile.rating,
                  reviewsCount: retainedCustomerProfile.reviewsCount,
                }
              : {}),
          },
        });
      }
      return taskCount;
    });

    const assetCleanup = await this.storage.attemptImmediate(entityType, user.id, queued);
    await Promise.all([
      this.cache.invalidate(CacheNamespace.AdminAnalytics),
      ...(role === UserRole.Tasker ? [this.cache.invalidate(CacheNamespace.EliteProgram)] : []),
    ]);
    return {
      success: true,
      data: { id: String(user.id), role, deleted: true, identityRetained: true, irreversible: true, assetCleanup },
      message: `${this.roleLabel(role)} profile permanently deleted; the other role remains active.`,
    };
  }

  private async blockers(
    userId: number,
    role: UserRole,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<DeletionBlocker[]> {
    const isCustomer = role === UserRole.Customer;
    const isTasker = role === UserRole.Tasker;
    const isMarketplace = isCustomer || isTasker;
    const roleProgram = isCustomer ? 'customer' : isTasker ? 'tasker' : undefined;
    const bookingSide: Prisma.BookingWhereInput = isCustomer
      ? { customerId: userId }
      : isTasker
        ? { taskerId: userId }
        : { OR: [{ customerId: userId }, { taskerId: userId }] };

    const [
      bookings,
      payments,
      customerLedger,
      customerWallet,
      walletLedger,
      taskerWallet,
      earnings,
      receivables,
      platformAccount,
      platformLedger,
      withdrawals,
      reviews,
      complaints,
      evidenceRequests,
      disputeResolutions,
      messages,
      calls,
      externalSupportMessages,
      referralAttributions,
      referralRewards,
      eliteEvaluations,
      eliteTransitions,
    ] = await Promise.all([
      client.booking.count({ where: bookingSide }),
      isCustomer ? client.paymentTransaction.count({ where: { customerId: userId } }) : Promise.resolve(0),
      isCustomer ? client.customerWalletLedgerEntry.count({ where: { customerId: userId } }) : Promise.resolve(0),
      isCustomer
        ? client.customerWallet.findUnique({ where: { customerId: userId }, select: { availableBalance: true } })
        : Promise.resolve(null),
      isTasker ? client.taskerWalletLedgerEntry.count({ where: { taskerId: userId } }) : Promise.resolve(0),
      isTasker
        ? client.taskerWallet.findUnique({ where: { taskerId: userId }, select: { availableBalance: true, pendingBalance: true } })
        : Promise.resolve(null),
      isTasker ? client.taskerEarning.count({ where: { taskerId: userId } }) : Promise.resolve(0),
      isTasker
        ? client.taskerPlatformReceivable.count({ where: { OR: [{ taskerId: userId }, { confirmedById: userId }] } })
        : Promise.resolve(0),
      isTasker
        ? client.taskerPlatformAccount.findUnique({ where: { taskerId: userId }, select: { outstandingPayable: true } })
        : Promise.resolve(null),
      isTasker ? client.taskerPlatformLedgerEntry.count({ where: { taskerId: userId } }) : Promise.resolve(0),
      isTasker ? client.taskerWithdrawal.count({ where: { taskerId: userId } }) : Promise.resolve(0),
      client.review.count({
        where: isMarketplace ? { booking: bookingSide } : { OR: [{ reviewerId: userId }, { revieweeId: userId }] },
      }),
      client.taskComplaint.count({
        where: isMarketplace ? { booking: bookingSide, filedById: userId } : { filedById: userId },
      }),
      isMarketplace ? Promise.resolve(0) : client.disputeEvidenceRequest.count({ where: { createdById: userId } }),
      isMarketplace ? Promise.resolve(0) : client.disputeResolution.count({ where: { actorId: userId } }),
      client.taskMessage.count({
        where: isMarketplace ? { senderId: userId, booking: bookingSide } : { senderId: userId },
      }),
      client.conversationCall.count({
        where: isMarketplace
          ? { booking: bookingSide, OR: [{ initiatorId: userId }, { recipientId: userId }] }
          : { OR: [{ initiatorId: userId }, { recipientId: userId }] },
      }),
      client.supportTicketMessage.count({
        where: isMarketplace
          ? { senderId: userId, ticket: { requesterRole: role, userId: { not: userId } } }
          : { senderId: userId, ticket: { userId: { not: userId } } },
      }),
      roleProgram
        ? client.referral.count({
            where: { program: roleProgram, OR: [{ referrerId: userId }, { referredUserId: userId }] },
          })
        : client.referral.count({ where: { OR: [{ referrerId: userId }, { referredUserId: userId }] } }),
      roleProgram
        ? client.referralReward.count({ where: { recipientId: userId, recipientRole: role } })
        : client.referralReward.count({ where: { recipientId: userId } }),
      isTasker ? client.eliteEvaluation.count({ where: { taskerId: userId } }) : Promise.resolve(0),
      isTasker ? client.eliteTierTransition.count({ where: { taskerId: userId } }) : Promise.resolve(0),
    ]);

    const values: Array<[string, number, string]> = [
      ['bookings', bookings, 'Booking history must remain consistent for both participants.'],
      ['payment_transactions', payments, 'Provider-backed payment history cannot be erased.'],
      ['customer_wallet_ledger', customerLedger, 'Customer ledger entries are immutable.'],
      [
        'customer_wallet_balance',
        customerWallet && Number(customerWallet.availableBalance) !== 0 ? 1 : 0,
        'A non-zero Customer wallet balance must be settled before deletion.',
      ],
      ['tasker_wallet_ledger', walletLedger, 'Tasker ledger entries are immutable.'],
      [
        'tasker_wallet_balance',
        taskerWallet &&
        (Number(taskerWallet.availableBalance) !== 0 || Number(taskerWallet.pendingBalance) !== 0)
          ? 1
          : 0,
        'Pending or available Tasker money must be settled before deletion.',
      ],
      ['tasker_earnings', earnings, 'Earning clearance and reversal history is protected.'],
      ['platform_receivables', receivables, 'Cash commission receivables are protected.'],
      [
        'platform_payable_balance',
        platformAccount && Number(platformAccount.outstandingPayable) !== 0 ? 1 : 0,
        'Outstanding cash commission debt must be settled before deletion.',
      ],
      ['platform_ledger', platformLedger, 'Platform payable ledger entries are immutable.'],
      ['withdrawals', withdrawals, 'Payout and withdrawal history is protected.'],
      ['reviews', reviews, 'Booking-linked review history is protected.'],
      ['disputes', complaints, 'Dispute and evidence history is protected.'],
      ['dispute_evidence_requests', evidenceRequests, 'Administrator-authored evidence requests are protected audit history.'],
      ['dispute_resolutions', disputeResolutions, 'Provider-backed dispute resolution history is protected.'],
      ['conversation_messages', messages, 'Booking conversation history is protected.'],
      ['conversation_calls', calls, 'Booking call history is protected.'],
      ['external_support_messages', externalSupportMessages, 'Messages authored in another user’s support case must be retained.'],
      ['referral_attributions', referralAttributions, 'Referral attribution and qualification history must remain auditable.'],
      ['referral_rewards', referralRewards, 'Referral reward and reversal accounting is immutable financial history.'],
      ['elite_evaluations', eliteEvaluations, 'Elite eligibility evaluations are protected operational history.'],
      ['elite_transitions', eliteTransitions, 'Elite tier transition history is protected operational history.'],
    ];
    return values
      .filter(([, count]) => count > 0)
      .map(([resource, count, blockerReason]) => ({ resource, count, reason: blockerReason }));
  }

  private roleLabel(role: UserRole): string {
    if (role === UserRole.Tasker) return 'Tasker';
    if (role === UserRole.Admin) return 'Administrator';
    return 'Customer';
  }
}
