import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '../../../generated/prisma/client';
import { Prisma } from '../../../generated/prisma/client';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { PrismaService } from '../../../database/prisma.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  WALLET_ENTRY_KIND,
  WITHDRAWAL_STATUS,
} from '../../tasker-dashboard/tasker-dashboard.constants';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';
import { PAYMENT_STATUS } from '../../payments/payments.constants';
import { AdminFinanceQueryDto, AdminPayoutActionDto } from '../dto/admin-finance.dto';
import { TaskerFinanceService } from '../../tasker-finance/tasker-finance.service';
import type { AdminEarningActionDto } from '../../tasker-finance/dto/tasker-finance.dto';

const money = (value: Prisma.Decimal | number | string | null | undefined): number =>
  Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

@Injectable()
export class AdminFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: PlatformSettingsService,
    private readonly taskerFinance: TaskerFinanceService,
  ) {}

  async read(query: AdminFinanceQueryDto) {
    const view = query.view ?? 'overview';
    if (view === 'overview') return this.overview(query);
    if (view === 'transactions') return this.transactions(query);
    if (view === 'refunds') return this.refunds(query);
    if (view === 'payouts') return this.payouts(query);
    if (view === 'earnings') {
      return this.taskerFinance.listAdminEarnings({
        ...query,
        from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
        to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
      });
    }
    if (view === 'cash_receivables') {
      return this.taskerFinance.listAdminReceivables({
        ...query,
        from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
        to: query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined,
      });
    }
    if (view === 'chargebacks') return this.chargebacks(query);
    return this.revenue(query);
  }

  async csv(
    query: AdminFinanceQueryDto,
  ): Promise<{ body: string; filename: string; truncated: boolean }> {
    const view = query.view ?? 'transactions';
    if (
      ![
        'transactions',
        'refunds',
        'payouts',
        'revenue',
        'earnings',
        'cash_receivables',
        'chargebacks',
      ].includes(view)
    ) {
      throw new BadRequestException(
        'CSV export is available for transactions, refunds, payouts, revenue, earnings, cash_receivables, and chargebacks views',
      );
    }
    const data = await this.read({ ...query, format: 'json', page: 1, limit: 100 });
    const rows = 'items' in data && Array.isArray(data.items) ? data.items : [];
    if (rows.length === 0) {
      return { body: '', filename: `latache-finance-${view}.csv`, truncated: false };
    }
    const keys = [...new Set(rows.flatMap((row) => Object.keys(row as Record<string, unknown>)))];
    const lines = [keys.map(csvCell).join(',')];
    for (const row of rows as Array<Record<string, unknown>>) {
      lines.push(
        keys
          .map((key) => {
            const value = row[key];
            return csvCell(
              typeof value === 'object' && value !== null ? JSON.stringify(value) : value,
            );
          })
          .join(','),
      );
    }
    const totalItems =
      'totalItems' in data && typeof data.totalItems === 'number' ? data.totalItems : rows.length;
    return {
      body: `${lines.join('\n')}\n`,
      filename: `latache-finance-${view}.csv`,
      truncated: totalItems > rows.length,
    };
  }

  async payoutAction(actor: User, id: string, dto: AdminPayoutActionDto) {
    const result = await this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "TaskerWithdrawals" WHERE "id" = ${id} FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Payout request not found');

      const withdrawal = await transaction.taskerWithdrawal.findUnique({
        where: { id },
        include: { payoutMethod: true, tasker: true },
      });
      if (!withdrawal) throw new NotFoundException('Payout request not found');
      const amount = money(withdrawal.amount);

      if (dto.action === 'approve') {
        if (withdrawal.status !== WITHDRAWAL_STATUS.PendingReview) {
          throw new ConflictException('Only pending-review payouts can be approved');
        }
        const updated = await transaction.taskerWithdrawal.update({
          where: { id },
          data: {
            status: WITHDRAWAL_STATUS.Processing,
            reviewedById: actor.id,
            reviewedAt: new Date(),
            adminNote: dto.note ?? null,
          },
          include: { payoutMethod: true, tasker: true },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: withdrawal.taskerId,
            action: 'tasker_payout_approved',
            entityType: 'tasker_withdrawal',
            entityId: id,
            reason: dto.note,
            metadata: {
              amount,
              currency: withdrawal.currency,
              payoutMethodType: withdrawal.payoutMethod.type,
            },
          },
          transaction,
        );
        await this.notifications.create(
          withdrawal.taskerId,
          {
            category: 'wallet',
            type: 'withdrawal_approved',
            title: 'Withdrawal approved',
            body: `Your ${withdrawal.currency} ${amount.toFixed(2)} withdrawal is approved and awaiting transfer confirmation.`,
            entityType: 'withdrawal',
            entityId: id,
          },
          transaction,
        );
        return updated;
      }

      if (dto.action === 'mark_paid') {
        if (withdrawal.status !== WITHDRAWAL_STATUS.Processing) {
          throw new ConflictException('Only approved/processing payouts can be marked paid');
        }
        if (!dto.providerReference?.trim()) {
          throw new BadRequestException(
            'providerReference is required to confirm an actual external payout',
          );
        }
        await transaction.$queryRaw`
          SELECT "taskerId" FROM "TaskerWallets" WHERE "taskerId" = ${withdrawal.taskerId} FOR UPDATE
        `;
        const wallet = await transaction.taskerWallet.findUniqueOrThrow({
          where: { taskerId: withdrawal.taskerId },
        });
        if (money(wallet.pendingBalance) + 0.0001 < amount) {
          throw new ConflictException(
            'Tasker pending wallet balance is lower than the payout amount',
          );
        }
        await transaction.taskerWallet.update({
          where: { taskerId: withdrawal.taskerId },
          data: { pendingBalance: { decrement: amount.toFixed(2) } },
        });
        await transaction.taskerWalletLedgerEntry.upsert({
          where: { idempotencyKey: `withdrawal:${id}:paid` },
          create: {
            taskerId: withdrawal.taskerId,
            withdrawalId: id,
            kind: WALLET_ENTRY_KIND.WithdrawalPaid,
            status: 'settled',
            amount: amount.toFixed(2),
            availableDelta: '0.00',
            pendingDelta: (-amount).toFixed(2),
            currency: withdrawal.currency,
            description: `Payout completed (${dto.providerReference})`,
            externalReference: dto.providerReference,
            idempotencyKey: `withdrawal:${id}:paid`,
          },
          update: {},
        });
        const updated = await transaction.taskerWithdrawal.update({
          where: { id },
          data: {
            status: WITHDRAWAL_STATUS.Paid,
            providerReference: dto.providerReference,
            processedAt: new Date(),
            reviewedById: actor.id,
            reviewedAt: withdrawal.reviewedAt ?? new Date(),
            adminNote: dto.note ?? withdrawal.adminNote,
            failureReason: null,
          },
          include: { payoutMethod: true, tasker: true },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: withdrawal.taskerId,
            action: 'tasker_payout_marked_paid',
            entityType: 'tasker_withdrawal',
            entityId: id,
            reason: dto.note,
            metadata: {
              amount,
              currency: withdrawal.currency,
              providerReference: dto.providerReference,
            },
          },
          transaction,
        );
        await this.notifications.create(
          withdrawal.taskerId,
          {
            category: 'wallet',
            type: 'withdrawal_paid',
            title: 'Withdrawal sent',
            body: `${withdrawal.currency} ${amount.toFixed(2)} has been marked transferred to your payout account.`,
            entityType: 'withdrawal',
            entityId: id,
          },
          transaction,
        );
        return updated;
      }

      if (dto.action === 'reject' && withdrawal.status !== WITHDRAWAL_STATUS.PendingReview) {
        throw new ConflictException('Only pending-review payouts can be rejected');
      }
      if (dto.action === 'mark_failed' && withdrawal.status !== WITHDRAWAL_STATUS.Processing) {
        throw new ConflictException('Only processing payouts can be marked failed');
      }
      if (!dto.note?.trim()) {
        throw new BadRequestException(
          'A note/reason is required when rejecting or failing a payout',
        );
      }

      await transaction.$queryRaw`
        SELECT "taskerId" FROM "TaskerWallets" WHERE "taskerId" = ${withdrawal.taskerId} FOR UPDATE
      `;
      const wallet = await transaction.taskerWallet.findUniqueOrThrow({
        where: { taskerId: withdrawal.taskerId },
      });
      if (money(wallet.pendingBalance) + 0.0001 < amount) {
        throw new ConflictException(
          'Tasker pending wallet balance is lower than the payout amount',
        );
      }
      await transaction.taskerWallet.update({
        where: { taskerId: withdrawal.taskerId },
        data: {
          availableBalance: { increment: amount.toFixed(2) },
          pendingBalance: { decrement: amount.toFixed(2) },
        },
      });
      const releaseKey = `withdrawal:${id}:${dto.action}-release`;
      await transaction.taskerWalletLedgerEntry.upsert({
        where: { idempotencyKey: releaseKey },
        create: {
          taskerId: withdrawal.taskerId,
          withdrawalId: id,
          kind: WALLET_ENTRY_KIND.WithdrawalRelease,
          status: 'settled',
          amount: amount.toFixed(2),
          availableDelta: amount.toFixed(2),
          pendingDelta: (-amount).toFixed(2),
          currency: withdrawal.currency,
          description:
            dto.action === 'reject'
              ? 'Payout request rejected; reservation released'
              : 'Payout failed; reservation released',
          idempotencyKey: releaseKey,
        },
        update: {},
      });
      const finalStatus =
        dto.action === 'reject' ? WITHDRAWAL_STATUS.Rejected : WITHDRAWAL_STATUS.Failed;
      const updated = await transaction.taskerWithdrawal.update({
        where: { id },
        data: {
          status: finalStatus,
          failureReason: dto.note,
          reviewedById: actor.id,
          reviewedAt: new Date(),
          adminNote: dto.note,
          processedAt: dto.action === 'mark_failed' ? new Date() : null,
        },
        include: { payoutMethod: true, tasker: true },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: withdrawal.taskerId,
          action: dto.action === 'reject' ? 'tasker_payout_rejected' : 'tasker_payout_failed',
          entityType: 'tasker_withdrawal',
          entityId: id,
          reason: dto.note,
          metadata: { amount, currency: withdrawal.currency },
        },
        transaction,
      );
      await this.notifications.create(
        withdrawal.taskerId,
        {
          category: 'wallet',
          type: dto.action === 'reject' ? 'withdrawal_rejected' : 'withdrawal_failed',
          title: dto.action === 'reject' ? 'Withdrawal rejected' : 'Withdrawal failed',
          body: `${withdrawal.currency} ${amount.toFixed(2)} has been returned to your available balance.`,
          entityType: 'withdrawal',
          entityId: id,
        },
        transaction,
      );
      return updated;
    });

    return this.serializePayout(result);
  }

  earningAction(actor: User, id: string, dto: AdminEarningActionDto) {
    return this.taskerFinance.earningAction({
      actorId: actor.id,
      earningId: id,
      action: dto.action,
      reason: dto.reason,
      holdUntil: dto.holdUntil ? new Date(dto.holdUntil) : undefined,
    });
  }

  private async overview(query: AdminFinanceQueryDto) {
    const date = this.dateFilter(query);
    const [
      charges,
      refunds,
      payouts,
      wallets,
      taskerWallets,
      bookingRevenue,
      recent,
      settings,
      earnings,
      receivables,
      platformAccounts,
    ] = await Promise.all([
      this.prisma.paymentTransaction.aggregate({
        where: { kind: 'booking_charge', status: 'succeeded', createdAt: date },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.paymentTransaction.aggregate({
        where: { kind: 'refund', status: 'succeeded', createdAt: date },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.taskerWithdrawal.groupBy({
        by: ['status'],
        where: { requestedAt: date },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.customerWallet.aggregate({ _sum: { availableBalance: true }, _count: true }),
      this.prisma.taskerWallet.aggregate({
        _sum: { availableBalance: true, pendingBalance: true },
        _count: true,
      }),
      this.prisma.booking.aggregate({
        where: {
          paymentStatus: {
            in: [PAYMENT_STATUS.Paid, PAYMENT_STATUS.PartiallyRefunded, PAYMENT_STATUS.Refunded],
          },
          ...(date ? { paidAt: date } : {}),
        },
        _sum: {
          platformFeeAmount: true,
          taxAmount: true,
          serviceSurchargeAmount: true,
        },
        _count: true,
      }),
      this.transactions({ ...query, page: 1, limit: 8 }),
      this.settings.view('commission,tax,currency'),
      this.prisma.taskerEarning.groupBy({
        by: ['status'],
        where: date ? { settledAt: date } : undefined,
        _sum: {
          taskerNetAmount: true,
          reversedAmount: true,
          debtOffsetAmount: true,
          releasedToAvailableAmount: true,
        },
        _count: true,
      }),
      this.prisma.taskerPlatformReceivable.aggregate({
        where: date ? { confirmedAt: date } : undefined,
        _sum: { originalPayableAmount: true, outstandingAmount: true, settledAmount: true },
        _count: true,
      }),
      this.prisma.taskerPlatformAccount.aggregate({
        _sum: { outstandingPayable: true },
        _count: true,
      }),
    ]);
    const payoutMap = Object.fromEntries(
      payouts.map((row) => [row.status, { count: row._count, amount: money(row._sum.amount) }]),
    );
    return {
      grossCollected: money(charges._sum.amount),
      refundsIssued: money(refunds._sum.amount),
      netCollected: money(money(charges._sum.amount) - money(refunds._sum.amount)),
      platformRevenue: {
        commissionEarnedGross: money(bookingRevenue._sum.platformFeeAmount),
        taxCollectedGross: money(bookingRevenue._sum.taxAmount),
        serviceSurchargesGross: money(bookingRevenue._sum.serviceSurchargeAmount),
        settledBookings: bookingRevenue._count,
        refundAllocationToPlatformComponentsAvailable: false,
        note: 'Refunds are tracked exactly as customer-facing refund amounts. They are not guessed into commission/tax/surcharge allocations until an explicit accounting allocation policy exists.',
      },
      escrow: {
        trackingAvailable: false,
        balance: null,
        note: 'Latache currently charges after task completion and has no escrow ledger; an escrow balance is therefore not fabricated.',
      },
      successfulCharges: charges._count,
      successfulRefunds: refunds._count,
      customerWalletLiability: money(wallets._sum.availableBalance),
      taskerWalletLiability: {
        available: money(taskerWallets._sum.availableBalance),
        pending: money(taskerWallets._sum.pendingBalance),
      },
      taskerEarningsClearance: Object.fromEntries(
        earnings.map((row) => [
          row.status,
          {
            count: row._count,
            taskerNetAmount: money(row._sum.taskerNetAmount),
            reversedAmount: money(row._sum.reversedAmount),
            debtOffsetAmount: money(row._sum.debtOffsetAmount),
            releasedToAvailableAmount: money(row._sum.releasedToAvailableAmount),
          },
        ]),
      ),
      cashPlatformReceivables: {
        count: receivables._count,
        created: money(receivables._sum.originalPayableAmount),
        outstandingInPeriodRecords: money(receivables._sum.outstandingAmount),
        settledFromPeriodRecords: money(receivables._sum.settledAmount),
        currentOutstandingAccountBalance: money(platformAccounts._sum.outstandingPayable),
        taskerAccounts: platformAccounts._count,
        note: 'Cash is physically held by Taskers. This is a platform receivable, not escrow or Tasker wallet money.',
      },
      payouts: payoutMap,
      recentTransactions: recent.items,
      policy: settings,
    };
  }

  private async transactions(query: AdminFinanceQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const date = this.dateFilter(query);
    const take = Math.min(offset + limit, 1000);
    const search = query.search?.trim();
    const paymentWhere: Prisma.PaymentTransactionWhereInput = {
      createdAt: date,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type === 'payout'
        ? { id: '__exclude_payout_only__' }
        : query.type
          ? { kind: query.type }
          : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { providerReference: { contains: search, mode: 'insensitive' } },
              { customer: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const withdrawalWhere: Prisma.TaskerWithdrawalWhereInput = {
      requestedAt: date,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type && query.type !== 'payout' ? { id: '__exclude__' } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { providerReference: { contains: search, mode: 'insensitive' } },
              { tasker: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [payments, paymentCount, withdrawals, withdrawalCount] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where: paymentWhere,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
          booking: { select: { id: true, service: { select: { name: true } } } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.paymentTransaction.count({ where: paymentWhere }),
      this.prisma.taskerWithdrawal.findMany({
        where: withdrawalWhere,
        include: {
          tasker: { select: { id: true, firstName: true, lastName: true, email: true } },
          payoutMethod: { select: { type: true, label: true, maskedIdentifier: true } },
        },
        orderBy: { requestedAt: 'desc' },
        take,
      }),
      this.prisma.taskerWithdrawal.count({ where: withdrawalWhere }),
    ]);
    const combined = [
      ...payments.map((row) => ({
        id: row.id,
        source: 'payment' as const,
        type: row.kind,
        status: row.status,
        amount: money(row.amount),
        currency: row.currency,
        party: row.customer,
        bookingId: row.bookingId,
        service: row.booking?.service.name ?? null,
        provider: row.provider,
        reference: row.providerReference,
        failureReason: row.failureReason,
        occurredAt: row.createdAt.toISOString(),
      })),
      ...withdrawals.map((row) => ({
        id: row.id,
        source: 'payout' as const,
        type: 'payout',
        status: row.status,
        amount: money(row.amount),
        currency: row.currency,
        party: row.tasker,
        bookingId: null,
        service: null,
        provider: row.payoutMethod.type,
        reference: row.providerReference,
        failureReason: row.failureReason,
        occurredAt: row.requestedAt.toISOString(),
      })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const totalItems = paymentCount + withdrawalCount;
    return {
      view: 'transactions',
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: combined.slice(offset, offset + limit),
    };
  }

  private async refunds(query: AdminFinanceQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const date = this.dateFilter(query);
    const search = query.search?.trim();
    const where: Prisma.DisputeResolutionWhereInput = {
      createdAt: date,
      actionType: {
        in: [
          'full_refund',
          'partial_refund',
          'full_refund_and_warning',
          'partial_refund_and_warning',
        ],
      },
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { complaintId: { contains: search, mode: 'insensitive' } },
              {
                complaint: {
                  booking: { customer: { email: { contains: search, mode: 'insensitive' } } },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.disputeResolution.findMany({
        where,
        include: {
          complaint: {
            include: {
              booking: {
                include: {
                  customer: { select: { id: true, firstName: true, lastName: true, email: true } },
                  tasker: { select: { id: true, firstName: true, lastName: true, email: true } },
                  service: { select: { id: true, name: true } },
                },
              },
            },
          },
          actor: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.disputeResolution.count({ where }),
    ]);
    return {
      view: 'refunds',
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        id: row.id,
        disputeId: row.complaintId,
        bookingId: row.complaint.bookingId,
        actionType: row.actionType,
        status: row.status,
        amount: row.refundAmount === null ? null : money(row.refundAmount),
        currency: row.currency,
        providerRefundId: row.providerRefundId,
        providerRefundStatus: row.providerRefundStatus,
        failureReason: row.failureReason,
        customer: row.complaint.booking.customer,
        tasker: row.complaint.booking.tasker,
        service: row.complaint.booking.service,
        proposedBy: row.actor,
        createdAt: row.createdAt.toISOString(),
        appliedAt: row.appliedAt?.toISOString() ?? null,
        resolutionApi: `/api/admin/disputes/${row.complaintId}/actions`,
      })),
    };
  }

  private async payouts(query: AdminFinanceQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const date = this.dateFilter(query);
    const search = query.search?.trim();
    const where: Prisma.TaskerWithdrawalWhereInput = {
      requestedAt: date,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { providerReference: { contains: search, mode: 'insensitive' } },
              { tasker: { email: { contains: search, mode: 'insensitive' } } },
              { tasker: { firstName: { contains: search, mode: 'insensitive' } } },
              { tasker: { lastName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.taskerWithdrawal.findMany({
        where,
        include: {
          tasker: {
            select: { id: true, firstName: true, lastName: true, email: true, rating: true },
          },
          payoutMethod: { select: { id: true, type: true, label: true, maskedIdentifier: true } },
        },
        orderBy: { requestedAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.taskerWithdrawal.count({ where }),
    ]);
    const statusCounts = await this.prisma.taskerWithdrawal.groupBy({
      by: ['status'],
      where: { requestedAt: date },
      _count: true,
      _sum: { amount: true },
    });
    return {
      view: 'payouts',
      summary: Object.fromEntries(
        statusCounts.map((row) => [
          row.status,
          { count: row._count, amount: money(row._sum.amount) },
        ]),
      ),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => this.serializePayout(row)),
    };
  }

  private async chargebacks(query: AdminFinanceQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const date = this.dateFilter(query);
    const search = query.search?.trim();
    const where: Prisma.StripeChargebackWhereInput = {
      createdAt: date,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { chargeId: { contains: search, mode: 'insensitive' } },
              { paymentIntentId: { contains: search, mode: 'insensitive' } },
              { reason: { contains: search, mode: 'insensitive' } },
              {
                booking: {
                  customer: { email: { contains: search, mode: 'insensitive' } },
                },
              },
              {
                booking: {
                  tasker: { email: { contains: search, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, totalItems, statusCounts] = await Promise.all([
      this.prisma.stripeChargeback.findMany({
        where,
        include: {
          booking: {
            include: {
              customer: { select: { id: true, firstName: true, lastName: true, email: true } },
              tasker: { select: { id: true, firstName: true, lastName: true, email: true } },
              service: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.stripeChargeback.count({ where }),
      this.prisma.stripeChargeback.groupBy({
        by: ['status'],
        where: { createdAt: date },
        _count: true,
        _sum: { amount: true },
      }),
    ]);
    return {
      view: 'chargebacks',
      summary: Object.fromEntries(
        statusCounts.map((row) => [
          row.status,
          { count: row._count, amount: money(row._sum.amount) },
        ]),
      ),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        id: row.id,
        bookingId: row.bookingId,
        chargeId: row.chargeId,
        paymentIntentId: row.paymentIntentId,
        status: row.status,
        reason: row.reason,
        amount: money(row.amount),
        currency: row.currency,
        evidenceDueBy: row.evidenceDueBy?.toISOString() ?? null,
        isChargeRefundable: row.isChargeRefundable,
        balanceTransactionId: row.balanceTransactionId,
        latestStripeEventType: row.latestStripeEventType,
        customer: row.booking?.customer ?? null,
        tasker: row.booking?.tasker ?? null,
        service: row.booking?.service ?? null,
        openedAt: row.openedAt.toISOString(),
        closedAt: row.closedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
        financialHandling:
          row.status === 'lost'
            ? 'Tasker finance remains blocked pending an auditable financial review; no clawback is fabricated.'
            : ['warning_needs_response', 'warning_under_review', 'needs_response', 'under_review'].includes(
                  row.status,
                )
              ? 'Tasker finance is held while the Stripe dispute is active.'
              : 'Provider dispute is closed; normal release rules still require all internal/provider holds to be clear.',
      })),
    };
  }

  private async revenue(query: AdminFinanceQueryDto) {
    const date = this.dateFilter(query);
    const transactions = await this.prisma.paymentTransaction.findMany({
      where: {
        createdAt: date,
        status: 'succeeded',
        kind: { in: ['booking_charge', 'refund'] },
      },
      include: { booking: { include: { service: { select: { id: true, name: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    const charges = transactions.filter((row) => row.kind === 'booking_charge');
    const refunds = transactions.filter((row) => row.kind === 'refund');
    const gross = money(charges.reduce((sum, row) => sum + Number(row.amount), 0));
    const refunded = money(refunds.reduce((sum, row) => sum + Number(row.amount), 0));
    const byDay = new Map<string, { charges: number; refunds: number }>();
    const byService = new Map<
      string,
      { serviceId: number | null; serviceName: string; gross: number; refunds: number }
    >();
    for (const row of transactions) {
      const day = row.createdAt.toISOString().slice(0, 10);
      const daily = byDay.get(day) ?? { charges: 0, refunds: 0 };
      if (row.kind === 'refund') daily.refunds += Number(row.amount);
      else daily.charges += Number(row.amount);
      byDay.set(day, daily);
      const service = row.booking?.service;
      const key = service ? String(service.id) : 'unallocated';
      const bucket = byService.get(key) ?? {
        serviceId: service?.id ?? null,
        serviceName: service?.name ?? 'Unallocated',
        gross: 0,
        refunds: 0,
      };
      if (row.kind === 'refund') bucket.refunds += Number(row.amount);
      else bucket.gross += Number(row.amount);
      byService.set(key, bucket);
    }
    return {
      view: 'revenue',
      grossCollected: gross,
      refundsIssued: refunded,
      netCollected: money(gross - refunded),
      chargeCount: charges.length,
      refundCount: refunds.length,
      timeline: [...byDay.entries()].map(([dateKey, value]) => ({
        date: dateKey,
        gross: money(value.charges),
        refunds: money(value.refunds),
        net: money(value.charges - value.refunds),
      })),
      items: [...byService.values()]
        .map((value) => ({
          ...value,
          gross: money(value.gross),
          refunds: money(value.refunds),
          net: money(value.gross - value.refunds),
        }))
        .sort((a, b) => b.net - a.net),
    };
  }

  private serializePayout(row: {
    id: string;
    amount: Prisma.Decimal;
    currency: string;
    status: string;
    requestedAt: Date;
    processedAt: Date | null;
    reviewedAt: Date | null;
    reviewedById: number | null;
    adminNote: string | null;
    providerReference: string | null;
    failureReason: string | null;
    tasker: {
      id: number;
      firstName: string | null;
      lastName: string | null;
      email: string;
      rating?: Prisma.Decimal;
    };
    payoutMethod: { id: string; type: string; label: string; maskedIdentifier: string };
  }) {
    return {
      id: row.id,
      amount: money(row.amount),
      currency: row.currency,
      status: row.status,
      tasker: {
        ...row.tasker,
        ...('rating' in row.tasker ? { rating: money(row.tasker.rating) } : {}),
      },
      payoutMethod: row.payoutMethod,
      providerReference: row.providerReference,
      failureReason: row.failureReason,
      adminNote: row.adminNote,
      reviewedById: row.reviewedById,
      requestedAt: row.requestedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      processedAt: row.processedAt?.toISOString() ?? null,
      allowedActions:
        row.status === WITHDRAWAL_STATUS.PendingReview
          ? ['approve', 'reject']
          : row.status === WITHDRAWAL_STATUS.Processing
            ? ['mark_paid', 'mark_failed']
            : [],
    };
  }

  private dateFilter(query: AdminFinanceQueryDto): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) return undefined;
    const filter: Prisma.DateTimeFilter = {};
    if (query.from) filter.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) filter.lte = new Date(`${query.to}T23:59:59.999Z`);
    return filter;
  }
}
