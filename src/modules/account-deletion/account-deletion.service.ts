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
      where: { id: userId, role: expectedRole, deletedAt: null },
      include: {
        supportTickets: {
          select: {
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

    const assets = this.storage.extractManagedAssets(
      user.profilePicture,
      user.identityDocument,
      user.workImages,
      user.supportTickets,
    );
    const entityType = expectedRole === UserRole.Admin ? 'administrator' : expectedRole;
    const queued = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: number; role: string }>>(Prisma.sql`
        SELECT "id", "role" FROM "Users" WHERE "id" = ${userId} FOR UPDATE
      `);
      if (locked[0]?.role !== expectedRole) {
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

  private async blockers(
    userId: number,
    role: UserRole,
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<DeletionBlocker[]> {
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
    ] = await Promise.all([
      client.booking.count({
        where:
          role === UserRole.Customer
            ? { customerId: userId }
            : role === UserRole.Tasker
              ? { taskerId: userId }
              : { OR: [{ customerId: userId }, { taskerId: userId }] },
      }),
      client.paymentTransaction.count({ where: { customerId: userId } }),
      client.customerWalletLedgerEntry.count({ where: { customerId: userId } }),
      client.customerWallet.findUnique({
        where: { customerId: userId },
        select: { availableBalance: true },
      }),
      client.taskerWalletLedgerEntry.count({ where: { taskerId: userId } }),
      client.taskerWallet.findUnique({
        where: { taskerId: userId },
        select: { availableBalance: true, pendingBalance: true },
      }),
      client.taskerEarning.count({ where: { taskerId: userId } }),
      client.taskerPlatformReceivable.count({
        where: { OR: [{ taskerId: userId }, { confirmedById: userId }] },
      }),
      client.taskerPlatformAccount.findUnique({
        where: { taskerId: userId },
        select: { outstandingPayable: true },
      }),
      client.taskerPlatformLedgerEntry.count({ where: { taskerId: userId } }),
      client.taskerWithdrawal.count({ where: { taskerId: userId } }),
      client.review.count({ where: { OR: [{ reviewerId: userId }, { revieweeId: userId }] } }),
      client.taskComplaint.count({ where: { filedById: userId } }),
      client.disputeEvidenceRequest.count({ where: { createdById: userId } }),
      client.disputeResolution.count({ where: { actorId: userId } }),
      client.taskMessage.count({ where: { senderId: userId } }),
      client.conversationCall.count({
        where: { OR: [{ initiatorId: userId }, { recipientId: userId }] },
      }),
      client.supportTicketMessage.count({
        where: { senderId: userId, ticket: { userId: { not: userId } } },
      }),
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
      [
        'dispute_evidence_requests',
        evidenceRequests,
        'Administrator-authored evidence requests are protected audit history.',
      ],
      [
        'dispute_resolutions',
        disputeResolutions,
        'Provider-backed dispute resolution history is protected.',
      ],
      ['conversation_messages', messages, 'Booking conversation history is protected.'],
      ['conversation_calls', calls, 'Booking call history is protected.'],
      [
        'external_support_messages',
        externalSupportMessages,
        'Messages authored in another user’s support case must be retained.',
      ],
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
