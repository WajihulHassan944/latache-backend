import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { WALLET_ENTRY_KIND } from '../tasker-dashboard/tasker-dashboard.constants';
import {
  EARNING_LEDGER_KIND,
  PLATFORM_LEDGER_KIND,
  PLATFORM_RECEIVABLE_STATUS,
  TASKER_EARNING_STATUS,
} from './tasker-finance.constants';
import type {
  ConfirmCashCollectionInput,
  CreatePendingEarningInput,
  EarningActionInput,
  EarningListQuery,
} from './tasker-finance.types';

const money = (value: Prisma.Decimal | number | string | null | undefined): number =>
  Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
const decimal = (value: number): string => money(value).toFixed(2);
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class TaskerFinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async createPendingEarning(input: CreatePendingEarningInput): Promise<void> {
    const { booking, transaction } = input;
    const serviceAmount = money(booking.serviceAmount);
    const platformCommissionAmount = money(booking.platformFeeAmount);
    const taxAmount = money(booking.taxAmount);
    const serviceSurchargeAmount = money(booking.serviceSurchargeAmount);
    const tipAmount = money(booking.tipAmount);
    const donationAmount = money(booking.donationAmount);
    const taskerNetAmount = money(
      serviceAmount - (booking.taxInclusive ? taxAmount : 0) + tipAmount,
    );
    if (taskerNetAmount < 0) {
      throw new ConflictException('Final pricing produced a negative Tasker net earning');
    }

    const existing = await transaction.taskerEarning.findUnique({
      where: { bookingId: booking.id },
    });
    if (existing) {
      if (
        existing.taskerId !== booking.taskerId ||
        existing.providerSettlementReference !== input.providerSettlementReference ||
        money(existing.taskerNetAmount) !== taskerNetAmount ||
        money(existing.grossCustomerAmount) !== money(input.grossCustomerAmount)
      ) {
        throw new ConflictException(
          'The booking settlement was already recorded with different financial parameters',
        );
      }
      return;
    }

    const policy = await this.settings.taskerFinancePolicy(transaction);
    const clearsAt = new Date(input.settledAt.getTime() + policy.earningClearanceDays * DAY_MS);
    await transaction.taskerWallet.upsert({
      where: { taskerId: booking.taskerId },
      create: { taskerId: booking.taskerId, currency: booking.paymentCurrency },
      update: {},
    });
    await transaction.$queryRaw`
      SELECT "taskerId" FROM "TaskerWallets"
      WHERE "taskerId" = ${booking.taskerId}
      FOR UPDATE
    `;
    const wallet = await transaction.taskerWallet.findUniqueOrThrow({
      where: { taskerId: booking.taskerId },
    });
    if (wallet.currency !== booking.paymentCurrency) {
      throw new ConflictException('Settlement currency does not match the Tasker wallet');
    }

    const earning = await transaction.taskerEarning.create({
      data: {
        bookingId: booking.id,
        taskerId: booking.taskerId,
        paymentSource: booking.paymentSource,
        grossCustomerAmount: decimal(input.grossCustomerAmount),
        serviceAmount: decimal(serviceAmount),
        platformCommissionAmount: decimal(platformCommissionAmount),
        taxAmount: decimal(taxAmount),
        serviceSurchargeAmount: decimal(serviceSurchargeAmount),
        tipAmount: decimal(tipAmount),
        donationAmount: decimal(donationAmount),
        taskerNetAmount: decimal(taskerNetAmount),
        currency: booking.paymentCurrency,
        status: TASKER_EARNING_STATUS.Pending,
        providerSettlementReference: input.providerSettlementReference,
        settledAt: input.settledAt,
        clearsAt,
      },
    });

    if (taskerNetAmount > 0) {
      await transaction.taskerWallet.update({
        where: { taskerId: booking.taskerId },
        data: { pendingBalance: { increment: decimal(taskerNetAmount) } },
      });
      await transaction.taskerWalletLedgerEntry.create({
        data: {
          taskerId: booking.taskerId,
          bookingId: booking.id,
          earningId: earning.id,
          kind: EARNING_LEDGER_KIND.PendingEarning,
          status: TASKER_EARNING_STATUS.Pending,
          amount: decimal(taskerNetAmount),
          availableDelta: '0.00',
          pendingDelta: decimal(taskerNetAmount),
          currency: booking.paymentCurrency,
          description: `Pending earning for booking #${booking.id}`,
          externalReference: input.providerSettlementReference,
          idempotencyKey: `booking:${booking.id}:pending-earning`,
        },
      });
    }

    await this.notifications.create(
      booking.taskerId,
      {
        category: 'wallet',
        type: 'booking_earning_pending',
        title: 'Earning is clearing',
        body: `${booking.paymentCurrency} ${taskerNetAmount.toFixed(2)} is pending and is expected to become available on ${clearsAt.toISOString()}.`,
        entityType: 'tasker_earning',
        entityId: earning.id,
        metadata: {
          bookingId: booking.id,
          status: TASKER_EARNING_STATUS.Pending,
          clearsAt: clearsAt.toISOString(),
        },
      },
      transaction,
    );
  }

  async confirmCashCollection(input: ConfirmCashCollectionInput) {
    if (!input.idempotencyKey.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    const policy = await this.settings.taskerFinancePolicy();
    const now = new Date();
    const receivable = await this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Bookings"
        WHERE "id" = ${input.bookingId} AND "taskerId" = ${input.taskerId}
        FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Booking not found');
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: input.bookingId },
      });
      if (booking.paymentSource !== 'cash' || booking.status !== 'completed') {
        throw new ConflictException('Cash can be confirmed only for a completed cash booking');
      }
      if (booking.paymentStatus === 'on_hold_dispute') {
        throw new ConflictException(
          'Cash confirmation is blocked while the booking dispute is active',
        );
      }
      if (!booking.totalChargedAmount) {
        throw new ConflictException('The booking final cash amount has not been calculated');
      }
      const expected = money(booking.totalChargedAmount);
      if (money(input.collectedAmount) !== expected) {
        throw new ConflictException(
          `Cash confirmation must match the final amount of ${booking.paymentCurrency} ${expected.toFixed(2)}`,
        );
      }

      const existing = await transaction.taskerPlatformReceivable.findUnique({
        where: { bookingId: booking.id },
      });
      if (existing) {
        if (
          existing.taskerId !== input.taskerId ||
          money(existing.cashCollectedAmount) !== money(input.collectedAmount) ||
          existing.confirmationIdempotencyKey !== input.idempotencyKey
        ) {
          throw new ConflictException(
            'This cash payment was already confirmed with different parameters',
          );
        }
        return existing;
      }

      await transaction.taskerPlatformAccount.upsert({
        where: { taskerId: input.taskerId },
        create: { taskerId: input.taskerId, currency: booking.paymentCurrency },
        update: {},
      });
      await transaction.$queryRaw`
        SELECT "taskerId" FROM "TaskerPlatformAccounts"
        WHERE "taskerId" = ${input.taskerId}
        FOR UPDATE
      `;
      const account = await transaction.taskerPlatformAccount.findUniqueOrThrow({
        where: { taskerId: input.taskerId },
      });
      if (account.currency !== booking.paymentCurrency) {
        throw new ConflictException('Cash currency does not match the Tasker platform account');
      }

      const serviceAmount = money(booking.serviceAmount);
      const taxAmount = money(booking.taxAmount);
      const taskerEconomicEarning = money(
        serviceAmount - (booking.taxInclusive ? taxAmount : 0) + money(booking.tipAmount),
      );
      const payable = money(expected - taskerEconomicEarning);
      if (payable < 0) {
        throw new ConflictException('Final cash accounting produced a negative platform payable');
      }
      const disputeClearsAt = new Date(now.getTime() + policy.cashDisputeClearanceDays * DAY_MS);
      const created = await transaction.taskerPlatformReceivable.create({
        data: {
          bookingId: booking.id,
          taskerId: input.taskerId,
          confirmedById: input.taskerId,
          confirmationIdempotencyKey: input.idempotencyKey,
          cashCollectedAmount: decimal(expected),
          serviceAmount: decimal(serviceAmount),
          platformCommissionAmount: booking.platformFeeAmount,
          taxAmount: booking.taxAmount,
          serviceSurchargeAmount: booking.serviceSurchargeAmount,
          tipAmount: booking.tipAmount,
          donationAmount: booking.donationAmount,
          taskerEconomicEarning: decimal(taskerEconomicEarning),
          originalPayableAmount: decimal(payable),
          outstandingAmount: decimal(payable),
          currency: booking.paymentCurrency,
          status:
            payable > 0
              ? PLATFORM_RECEIVABLE_STATUS.Outstanding
              : PLATFORM_RECEIVABLE_STATUS.Settled,
          disputeClearsAt,
          confirmedAt: now,
          settledAt: payable === 0 ? now : null,
        },
      });
      if (payable > 0) {
        await transaction.taskerPlatformAccount.update({
          where: { taskerId: input.taskerId },
          data: { outstandingPayable: { increment: decimal(payable) } },
        });
        await transaction.taskerPlatformLedgerEntry.create({
          data: {
            taskerId: input.taskerId,
            bookingId: booking.id,
            receivableId: created.id,
            kind: PLATFORM_LEDGER_KIND.CashPayableCreated,
            amount: decimal(payable),
            payableDelta: decimal(payable),
            currency: booking.paymentCurrency,
            description: `Platform payable created from cash booking #${booking.id}`,
            externalReference: `cash:${booking.id}`,
            idempotencyKey: `cash-booking:${booking.id}:payable-created`,
          },
        });
      }
      await transaction.booking.update({
        where: { id: booking.id },
        data: {
          paymentStatus: 'cash_confirmed',
          paidAt: now,
          paymentFailureReason: null,
        },
      });
      await transaction.paymentTransaction.create({
        data: {
          customerId: booking.customerId,
          bookingId: booking.id,
          kind: 'cash_collection',
          provider: 'cash_direct',
          providerReference: `cash:${booking.id}`,
          status: 'succeeded',
          amount: decimal(expected),
          currency: booking.paymentCurrency,
          idempotencyKey: `payment:cash-booking:${booking.id}`,
          metadata: {
            physicalPossession: 'tasker',
            taskerEconomicEarning: decimal(taskerEconomicEarning),
            platformPayable: decimal(payable),
          },
        },
      });

      const newOutstanding = money(account.outstandingPayable) + payable;
      await this.applyRestrictionPolicy(
        transaction,
        input.taskerId,
        newOutstanding,
        policy.maximumOutstandingPlatformDebt,
        policy.blockCashBookingsAtDebtLimit,
      );
      await this.notifications.create(
        input.taskerId,
        {
          category: 'wallet',
          type: 'cash_platform_payable_created',
          title: 'Cash payment recorded',
          body: `${booking.paymentCurrency} ${expected.toFixed(2)} cash was recorded. Your platform payable increased by ${booking.paymentCurrency} ${payable.toFixed(2)}.`,
          entityType: 'platform_receivable',
          entityId: created.id,
          metadata: {
            bookingId: booking.id,
            outstandingPlatformPayable: decimal(newOutstanding),
            disputeClearsAt: disputeClearsAt.toISOString(),
          },
        },
        transaction,
      );
      return created;
    });
    return this.serializeReceivable(receivable);
  }

  async assertCashBookingAllowed(taskerId: number): Promise<void> {
    const [policy, account] = await Promise.all([
      this.settings.taskerFinancePolicy(),
      this.prisma.taskerPlatformAccount.findUnique({ where: { taskerId } }),
    ]);
    const outstanding = money(account?.outstandingPayable);
    if (
      policy.blockCashBookingsAtDebtLimit &&
      policy.maximumOutstandingPlatformDebt > 0 &&
      outstanding >= policy.maximumOutstandingPlatformDebt - 0.005
    ) {
      throw new ConflictException(
        `Cash bookings are restricted until the outstanding platform payable falls below ${account?.currency ?? 'USD'} ${policy.maximumOutstandingPlatformDebt.toFixed(2)}`,
      );
    }
  }

  async blockForDispute(
    bookingId: number,
    reason: string,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const earning = await transaction.taskerEarning.findUnique({ where: { bookingId } });
    if (
      earning &&
      [TASKER_EARNING_STATUS.Pending, TASKER_EARNING_STATUS.PartiallyReversed].includes(
        earning.status as never,
      ) &&
      !earning.isBlocked
    ) {
      await transaction.taskerEarning.update({
        where: { id: earning.id },
        data: { isBlocked: true, blockReason: reason, blockedAt: new Date() },
      });
      await this.notifications.create(
        earning.taskerId,
        {
          category: 'wallet',
          type: 'booking_earning_blocked',
          title: 'Earning clearance paused',
          body: reason.slice(0, 500),
          entityType: 'tasker_earning',
          entityId: earning.id,
        },
        transaction,
      );
    }
    const receivable = await transaction.taskerPlatformReceivable.findUnique({
      where: { bookingId },
    });
    if (receivable && !receivable.isDisputed) {
      await transaction.taskerPlatformReceivable.update({
        where: { id: receivable.id },
        data: {
          isDisputed: true,
          disputeBlockReason: reason,
          disputeBlockedAt: new Date(),
        },
      });
    }
  }

  async unblockAfterDispute(
    bookingId: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = transaction ?? this.prisma;
    const [active, providerDisputes] = await Promise.all([
      client.taskComplaint.count({
        where: { bookingId, status: { in: ['open', 'under_investigation', 'escalated'] } },
      }),
      client.stripeChargeback.count({
        where: {
          bookingId,
          status: {
            in: [
              'warning_needs_response',
              'warning_under_review',
              'needs_response',
              'under_review',
              'lost',
            ],
          },
        },
      }),
    ]);
    if (active > 0 || providerDisputes > 0) return;
    await client.taskerEarning.updateMany({
      where: {
        bookingId,
        status: {
          in: [TASKER_EARNING_STATUS.Pending, TASKER_EARNING_STATUS.PartiallyReversed],
        },
      },
      data: { isBlocked: false, blockReason: null, blockedAt: null },
    });
    await client.taskerPlatformReceivable.updateMany({
      where: { bookingId },
      data: {
        isDisputed: false,
        disputeBlockReason: null,
        disputeBlockedAt: null,
        clearedAt: new Date(),
      },
    });
  }

  async applyConfirmedCashRefundReceivableReversal(
    transaction: Prisma.TransactionClient,
    bookingId: number,
    externalReference: string,
    refundAmount: number,
  ): Promise<{ reversalAmount: number; reimbursementAmount: number }> {
    const receivable = await transaction.taskerPlatformReceivable.findUnique({
      where: { bookingId },
    });
    if (!receivable) return { reversalAmount: 0, reimbursementAmount: 0 };

    const idempotencyKey = `cash-refund:${externalReference}:receivable-reversal`;
    const reimbursementKey = `cash-refund:${externalReference}:commission-reimbursement`;
    await transaction.$queryRaw`
      SELECT "id" FROM "TaskerPlatformReceivables"
      WHERE "id" = ${receivable.id}
      FOR UPDATE
    `;
    await transaction.$queryRaw`
      SELECT "taskerId" FROM "TaskerPlatformAccounts"
      WHERE "taskerId" = ${receivable.taskerId}
      FOR UPDATE
    `;
    const locked = await transaction.taskerPlatformReceivable.findUniqueOrThrow({
      where: { id: receivable.id },
    });
    const existingLedger = await transaction.taskerPlatformLedgerEntry.findUnique({
      where: { idempotencyKey },
    });
    if (existingLedger) {
      const reversalAmount = money(existingLedger.amount);
      const reimbursementAmount = Math.max(
        0,
        money(reversalAmount - Math.abs(money(existingLedger.payableDelta))),
      );
      return { reversalAmount, reimbursementAmount };
    }

    const collected = money(locked.cashCollectedAmount);
    if (collected <= 0) return { reversalAmount: 0, reimbursementAmount: 0 };
    const originalPayable = money(locked.originalPayableAmount);
    const alreadyReversed = money(locked.reversedAmount);
    const proportional = money((money(refundAmount) / collected) * originalPayable);
    const reversible = Math.max(0, money(originalPayable - alreadyReversed));
    const reversal = Math.min(proportional, reversible);
    if (reversal <= 0) return { reversalAmount: 0, reimbursementAmount: 0 };

    const outstandingBefore = money(locked.outstandingAmount);
    const outstandingReversal = Math.min(outstandingBefore, reversal);
    const reimbursementAmount = Math.max(0, money(reversal - outstandingReversal));
    const newOutstanding = money(outstandingBefore - outstandingReversal);
    const newReversed = money(alreadyReversed + reversal);
    const fullyReversed = newReversed >= originalPayable - 0.005;

    await transaction.taskerPlatformReceivable.update({
      where: { id: locked.id },
      data: {
        reversedAmount: decimal(newReversed),
        outstandingAmount: decimal(newOutstanding),
        status: fullyReversed
          ? PLATFORM_RECEIVABLE_STATUS.Reversed
          : PLATFORM_RECEIVABLE_STATUS.PartiallyReversed,
      },
    });
    if (outstandingReversal > 0) {
      await transaction.taskerPlatformAccount.update({
        where: { taskerId: locked.taskerId },
        data: { outstandingPayable: { decrement: decimal(outstandingReversal) } },
      });
    }

    if (reimbursementAmount > 0) {
      await transaction.taskerWallet.upsert({
        where: { taskerId: locked.taskerId },
        create: { taskerId: locked.taskerId, currency: locked.currency },
        update: {},
      });
      await transaction.$queryRaw`
        SELECT "taskerId" FROM "TaskerWallets"
        WHERE "taskerId" = ${locked.taskerId}
        FOR UPDATE
      `;
      const existingReimbursement = await transaction.taskerWalletLedgerEntry.findUnique({
        where: { idempotencyKey: reimbursementKey },
      });
      if (!existingReimbursement) {
        await transaction.taskerWallet.update({
          where: { taskerId: locked.taskerId },
          data: { availableBalance: { increment: decimal(reimbursementAmount) } },
        });
        await transaction.taskerWalletLedgerEntry.create({
          data: {
            taskerId: locked.taskerId,
            bookingId,
            kind: WALLET_ENTRY_KIND.Adjustment,
            status: 'settled',
            amount: decimal(reimbursementAmount),
            availableDelta: decimal(reimbursementAmount),
            pendingDelta: decimal(0),
            currency: locked.currency,
            description: `Platform commission reimbursement after confirmed cash refund for booking #${bookingId}`,
            externalReference,
            idempotencyKey: reimbursementKey,
          },
        });
      }
    }

    await transaction.taskerPlatformLedgerEntry.create({
      data: {
        taskerId: locked.taskerId,
        bookingId,
        receivableId: locked.id,
        kind: PLATFORM_LEDGER_KIND.ReceivableReversal,
        amount: decimal(reversal),
        payableDelta: decimal(-outstandingReversal),
        currency: locked.currency,
        description: `Cash dispute refund receivable reversal for booking #${bookingId}`,
        externalReference,
        idempotencyKey,
      },
    });
    return { reversalAmount: reversal, reimbursementAmount };
  }

  async applyRefundAdjustment(
    transaction: Prisma.TransactionClient,
    booking: {
      id: number;
      taskerId: number;
      serviceAmount: Prisma.Decimal | null;
      tipAmount: Prisma.Decimal;
      taxAmount?: Prisma.Decimal;
      taxInclusive?: boolean;
      totalChargedAmount: Prisma.Decimal | null;
      paymentCurrency: string;
      paymentSource?: string;
    },
    refundPayment: { id: string; amount: Prisma.Decimal },
  ): Promise<boolean> {
    const earning = await transaction.taskerEarning.findUnique({
      where: { bookingId: booking.id },
    });
    if (!earning) return false;
    const ledgerKey = `booking:${booking.id}:refund-clawback:${refundPayment.id}`;
    if (
      await transaction.taskerWalletLedgerEntry.findUnique({ where: { idempotencyKey: ledgerKey } })
    ) {
      return true;
    }
    await transaction.$queryRaw`
      SELECT "id" FROM "TaskerEarnings"
      WHERE "id" = ${earning.id}
      FOR UPDATE
    `;
    const lockedEarning = await transaction.taskerEarning.findUniqueOrThrow({
      where: { id: earning.id },
    });

    const totalCharged = money(booking.totalChargedAmount);
    const refunds = await transaction.paymentTransaction.aggregate({
      where: { bookingId: booking.id, kind: 'refund', status: 'succeeded' },
      _sum: { amount: true },
    });
    const cumulativeRefunded = money(refunds._sum.amount);
    const taskerNet = money(lockedEarning.taskerNetAmount);
    const remaining = money(taskerNet - money(lockedEarning.reversedAmount));
    const full = totalCharged > 0 && cumulativeRefunded >= totalCharged - 0.005;
    const proportional =
      totalCharged > 0
        ? money((money(refundPayment.amount) / totalCharged) * taskerNet)
        : money(refundPayment.amount);
    const clawback = Math.min(full ? remaining : proportional, remaining);
    if (clawback <= 0) return true;

    await transaction.$queryRaw`
      SELECT "taskerId" FROM "TaskerWallets"
      WHERE "taskerId" = ${booking.taskerId}
      FOR UPDATE
    `;
    const unreleased = Math.max(
      0,
      money(
        taskerNet -
          money(lockedEarning.reversedAmount) -
          money(lockedEarning.debtOffsetAmount) -
          money(lockedEarning.releasedToAvailableAmount),
      ),
    );
    const pendingReversal = Math.min(clawback, unreleased);
    const availableClawback = money(clawback - pendingReversal);
    await transaction.taskerWallet.update({
      where: { taskerId: booking.taskerId },
      data: {
        ...(pendingReversal > 0 ? { pendingBalance: { decrement: decimal(pendingReversal) } } : {}),
        ...(availableClawback > 0
          ? { availableBalance: { decrement: decimal(availableClawback) } }
          : {}),
      },
    });
    const newReversed = money(money(lockedEarning.reversedAmount) + clawback);
    const fullyReversed = newReversed >= taskerNet - 0.005;
    await transaction.taskerEarning.update({
      where: { id: earning.id },
      data: {
        reversedAmount: decimal(newReversed),
        status: fullyReversed
          ? TASKER_EARNING_STATUS.Reversed
          : TASKER_EARNING_STATUS.PartiallyReversed,
        reversalReason: `Settled refund transaction ${refundPayment.id}`,
        reversedAt: fullyReversed ? new Date() : null,
        isBlocked: fullyReversed ? false : lockedEarning.isBlocked,
      },
    });
    await transaction.taskerWalletLedgerEntry.create({
      data: {
        taskerId: booking.taskerId,
        bookingId: booking.id,
        earningId: earning.id,
        kind: pendingReversal > 0 ? EARNING_LEDGER_KIND.PendingReversal : 'refund',
        status: 'settled',
        amount: decimal(clawback),
        availableDelta: decimal(-availableClawback),
        pendingDelta: decimal(-pendingReversal),
        currency: booking.paymentCurrency,
        description: `Refund adjustment for booking #${booking.id}`,
        externalReference: refundPayment.id,
        idempotencyKey: ledgerKey,
      },
    });
    await this.notifications.create(
      booking.taskerId,
      {
        category: 'wallet',
        type: 'booking_earning_reversed',
        title: 'Booking earning adjusted',
        body: `${booking.paymentCurrency} ${clawback.toFixed(2)} was reversed after a settled refund.`,
        entityType: 'tasker_earning',
        entityId: earning.id,
        metadata: { pendingReversal, availableClawback },
      },
      transaction,
    );
    return true;
  }

  async releaseMatureEarning(earningId: string, now = new Date()): Promise<boolean> {
    const policy = await this.settings.taskerFinancePolicy();
    return this.prisma.$transaction(async (transaction) => {
      const earningRef = await transaction.taskerEarning.findUnique({
        where: { id: earningId },
        select: { bookingId: true },
      });
      if (!earningRef) return false;
      // Booking is the financial synchronization root for dispute/payment races.
      // Stripe chargeback ingestion and participant dispute opening use the same lock order.
      await transaction.$queryRaw`
        SELECT "id" FROM "Bookings"
        WHERE "id" = ${earningRef.bookingId}
        FOR UPDATE
      `;
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "TaskerEarnings"
        WHERE "id" = ${earningId}
        FOR UPDATE
      `;
      if (locked.length === 0) return false;
      const earning = await transaction.taskerEarning.findUniqueOrThrow({
        where: { id: earningId },
      });
      if (
        ![TASKER_EARNING_STATUS.Pending, TASKER_EARNING_STATUS.PartiallyReversed].includes(
          earning.status as never,
        ) ||
        earning.isBlocked ||
        earning.releasedAt !== null ||
        earning.clearsAt > now ||
        (earning.holdExtendedUntil && earning.holdExtendedUntil > now)
      )
        return false;

      const [activeDisputes, providerDisputes] = await Promise.all([
        transaction.taskComplaint.count({
          where: {
            bookingId: earning.bookingId,
            status: { in: ['open', 'under_investigation', 'escalated'] },
          },
        }),
        transaction.stripeChargeback.count({
          where: {
            bookingId: earning.bookingId,
            status: {
              in: [
                'warning_needs_response',
                'warning_under_review',
                'needs_response',
                'under_review',
                'lost',
              ],
            },
          },
        }),
      ]);
      if (activeDisputes > 0 || providerDisputes > 0) {
        await transaction.taskerEarning.update({
          where: { id: earning.id },
          data: {
            isBlocked: true,
            blockReason:
              providerDisputes > 0 ? 'Active Stripe chargeback review' : 'Active booking dispute',
            blockedAt: now,
          },
        });
        await this.notifications.create(
          earning.taskerId,
          {
            category: 'wallet',
            type: 'booking_earning_blocked',
            title: 'Earning clearance paused',
            body:
              providerDisputes > 0
                ? 'This earning remains pending while an active Stripe card dispute is reviewed.'
                : 'This earning remains pending while an active booking dispute is reviewed.',
            entityType: 'tasker_earning',
            entityId: earning.id,
          },
          transaction,
        );
        return false;
      }

      await transaction.taskerWallet.upsert({
        where: { taskerId: earning.taskerId },
        create: { taskerId: earning.taskerId, currency: earning.currency },
        update: {},
      });
      await transaction.taskerPlatformAccount.upsert({
        where: { taskerId: earning.taskerId },
        create: { taskerId: earning.taskerId, currency: earning.currency },
        update: {},
      });
      await transaction.$queryRaw`
        SELECT "taskerId" FROM "TaskerWallets"
        WHERE "taskerId" = ${earning.taskerId} FOR UPDATE
      `;
      await transaction.$queryRaw`
        SELECT "taskerId" FROM "TaskerPlatformAccounts"
        WHERE "taskerId" = ${earning.taskerId} FOR UPDATE
      `;
      const wallet = await transaction.taskerWallet.findUniqueOrThrow({
        where: { taskerId: earning.taskerId },
      });
      const account = await transaction.taskerPlatformAccount.findUniqueOrThrow({
        where: { taskerId: earning.taskerId },
      });
      if (wallet.currency !== earning.currency || account.currency !== earning.currency) {
        throw new ConflictException('Tasker finance account currency mismatch');
      }

      const releasable = Math.max(
        0,
        money(money(earning.taskerNetAmount) - money(earning.reversedAmount)),
      );
      const debtOffset = Math.min(releasable, money(account.outstandingPayable));
      const available = money(releasable - debtOffset);

      if (money(wallet.pendingBalance) + 0.005 < releasable) {
        throw new ConflictException('Tasker pending wallet balance is below the earning liability');
      }
      await transaction.taskerWallet.update({
        where: { taskerId: earning.taskerId },
        data: {
          pendingBalance: { decrement: decimal(releasable) },
          ...(available > 0 ? { availableBalance: { increment: decimal(available) } } : {}),
        },
      });

      let debtRemaining = debtOffset;
      if (debtRemaining > 0) {
        const receivables = await transaction.taskerPlatformReceivable.findMany({
          where: {
            taskerId: earning.taskerId,
            outstandingAmount: { gt: 0 },
            status: {
              in: [
                PLATFORM_RECEIVABLE_STATUS.Outstanding,
                PLATFORM_RECEIVABLE_STATUS.PartiallySettled,
                PLATFORM_RECEIVABLE_STATUS.PartiallyReversed,
              ],
            },
          },
          orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
        });
        for (const receivable of receivables) {
          if (debtRemaining <= 0) break;
          const offset = Math.min(debtRemaining, money(receivable.outstandingAmount));
          const newOutstanding = money(money(receivable.outstandingAmount) - offset);
          const newSettled = money(money(receivable.settledAmount) + offset);
          await transaction.taskerPlatformReceivable.update({
            where: { id: receivable.id },
            data: {
              outstandingAmount: decimal(newOutstanding),
              settledAmount: decimal(newSettled),
              status:
                newOutstanding <= 0
                  ? PLATFORM_RECEIVABLE_STATUS.Settled
                  : PLATFORM_RECEIVABLE_STATUS.PartiallySettled,
              settledAt: newOutstanding <= 0 ? now : null,
            },
          });
          await transaction.taskerPlatformLedgerEntry.create({
            data: {
              taskerId: earning.taskerId,
              bookingId: receivable.bookingId,
              receivableId: receivable.id,
              earningId: earning.id,
              kind: PLATFORM_LEDGER_KIND.EarningDebtOffset,
              amount: decimal(offset),
              payableDelta: decimal(-offset),
              currency: earning.currency,
              description: `Cash platform payable offset from earning ${earning.id}`,
              externalReference: earning.providerSettlementReference,
              idempotencyKey: `earning:${earning.id}:receivable:${receivable.id}:offset`,
            },
          });
          debtRemaining = money(debtRemaining - offset);
        }
        if (debtRemaining > 0.005) {
          throw new ConflictException(
            'Platform payable aggregate is inconsistent with receivable ledger',
          );
        }
        await transaction.taskerPlatformAccount.update({
          where: { taskerId: earning.taskerId },
          data: { outstandingPayable: { decrement: decimal(debtOffset) } },
        });
      }

      await transaction.taskerEarning.update({
        where: { id: earning.id },
        data: {
          status: TASKER_EARNING_STATUS.Available,
          debtOffsetAmount: decimal(debtOffset),
          releasedToAvailableAmount: decimal(available),
          releasedAt: now,
          isBlocked: false,
          blockReason: null,
          blockedAt: null,
        },
      });
      await transaction.taskerWalletLedgerEntry.create({
        data: {
          taskerId: earning.taskerId,
          bookingId: earning.bookingId,
          earningId: earning.id,
          kind: EARNING_LEDGER_KIND.EarningRelease,
          status: 'settled',
          amount: decimal(releasable),
          availableDelta: decimal(available),
          pendingDelta: decimal(-releasable),
          currency: earning.currency,
          description:
            debtOffset > 0
              ? `Earning released; ${earning.currency} ${debtOffset.toFixed(2)} offset against cash platform payable`
              : `Earning released for booking #${earning.bookingId}`,
          externalReference: earning.providerSettlementReference,
          idempotencyKey: `earning:${earning.id}:release`,
        },
      });

      const newOutstanding = money(money(account.outstandingPayable) - debtOffset);
      await this.applyRestrictionPolicy(
        transaction,
        earning.taskerId,
        newOutstanding,
        policy.maximumOutstandingPlatformDebt,
        policy.blockCashBookingsAtDebtLimit,
      );
      await this.notifications.create(
        earning.taskerId,
        {
          category: 'wallet',
          type: 'booking_earning_released',
          title: 'Earning is available',
          body:
            debtOffset > 0
              ? `${earning.currency} ${available.toFixed(2)} is available; ${earning.currency} ${debtOffset.toFixed(2)} settled your cash platform payable.`
              : `${earning.currency} ${available.toFixed(2)} is now available to withdraw.`,
          entityType: 'tasker_earning',
          entityId: earning.id,
          metadata: { available, debtOffset, outstandingPlatformPayable: newOutstanding },
        },
        transaction,
      );
      if (debtOffset > 0) {
        await this.notifications.create(
          earning.taskerId,
          {
            category: 'wallet',
            type: 'cash_platform_payable_settled',
            title: 'Cash platform payable reduced',
            body: `${earning.currency} ${debtOffset.toFixed(2)} of online earnings settled outstanding cash platform payable.`,
            entityType: 'tasker_platform_account',
            entityId: String(earning.taskerId),
            metadata: { earningId: earning.id, debtOffset, outstanding: newOutstanding },
          },
          transaction,
        );
      }
      return true;
    });
  }

  async markMatureCashReceivablesCleared(now = new Date()): Promise<number> {
    const result = await this.prisma.taskerPlatformReceivable.updateMany({
      where: {
        clearedAt: null,
        isDisputed: false,
        disputeClearsAt: { lte: now },
      },
      data: { clearedAt: now },
    });
    return result.count;
  }

  async reconcileCashRestrictions(): Promise<number> {
    const policy = await this.settings.taskerFinancePolicy();
    const accounts = await this.prisma.taskerPlatformAccount.findMany({
      where:
        policy.blockCashBookingsAtDebtLimit && policy.maximumOutstandingPlatformDebt > 0
          ? {
              OR: [
                { cashBookingsRestricted: true },
                { outstandingPayable: { gte: decimal(policy.maximumOutstandingPlatformDebt) } },
              ],
            }
          : { cashBookingsRestricted: true },
      select: { taskerId: true },
      orderBy: { taskerId: 'asc' },
      take: 500,
    });
    let changed = 0;
    for (const account of accounts) {
      changed += await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "taskerId" FROM "TaskerPlatformAccounts"
          WHERE "taskerId" = ${account.taskerId} FOR UPDATE
        `;
        const current = await transaction.taskerPlatformAccount.findUniqueOrThrow({
          where: { taskerId: account.taskerId },
        });
        const before = current.cashBookingsRestricted;
        await this.applyRestrictionPolicy(
          transaction,
          current.taskerId,
          money(current.outstandingPayable),
          policy.maximumOutstandingPlatformDebt,
          policy.blockCashBookingsAtDebtLimit,
        );
        const expected =
          policy.blockCashBookingsAtDebtLimit &&
          policy.maximumOutstandingPlatformDebt > 0 &&
          money(current.outstandingPayable) >= policy.maximumOutstandingPlatformDebt - 0.005;
        return before === expected ? 0 : 1;
      });
    }
    return changed;
  }

  async listTaskerEarnings(taskerId: number, query: EarningListQuery) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.TaskerEarningWhereInput = {
      taskerId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.prisma.taskerEarning.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              customer: { select: { id: true, firstName: true, lastName: true } },
              service: { select: { id: true, name: true, slug: true } },
            },
          },
        },
        orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.taskerEarning.count({ where }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: items.map((item) => this.serializeEarning(item)),
    };
  }

  async listAdminEarnings(query: EarningListQuery) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const where: Prisma.TaskerEarningWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            settledAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { providerSettlementReference: { contains: search, mode: 'insensitive' } },
              { tasker: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.prisma.taskerEarning.findMany({
        where,
        include: {
          tasker: { select: { id: true, firstName: true, lastName: true, email: true } },
          booking: { select: { id: true, service: { select: { id: true, name: true } } } },
        },
        orderBy: [{ settledAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.taskerEarning.count({ where }),
    ]);
    return {
      view: 'earnings',
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: items.map((item) => this.serializeEarning(item)),
    };
  }

  async listAdminReceivables(query: EarningListQuery) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const where: Prisma.TaskerPlatformReceivableWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.from || query.to
        ? {
            confirmedAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { tasker: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, totalItems] = await Promise.all([
      this.prisma.taskerPlatformReceivable.findMany({
        where,
        include: {
          tasker: { select: { id: true, firstName: true, lastName: true, email: true } },
          booking: { select: { id: true, service: { select: { id: true, name: true } } } },
        },
        orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.taskerPlatformReceivable.count({ where }),
    ]);
    return {
      view: 'cash_receivables',
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: items.map((item) => this.serializeReceivable(item)),
    };
  }

  async earningAction(input: EarningActionInput) {
    return this.prisma.$transaction(async (transaction) => {
      const earningRef = await transaction.taskerEarning.findUnique({
        where: { id: input.earningId },
        select: { bookingId: true },
      });
      if (!earningRef) throw new NotFoundException('Tasker earning not found');
      await transaction.$queryRaw`
        SELECT "id" FROM "Bookings" WHERE "id" = ${earningRef.bookingId} FOR UPDATE
      `;
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "TaskerEarnings" WHERE "id" = ${input.earningId} FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Tasker earning not found');
      const earning = await transaction.taskerEarning.findUniqueOrThrow({
        where: { id: input.earningId },
      });
      if (
        ![TASKER_EARNING_STATUS.Pending, TASKER_EARNING_STATUS.PartiallyReversed].includes(
          earning.status as never,
        ) ||
        earning.releasedAt !== null
      ) {
        throw new ConflictException('Only pending earnings can be held or released from a hold');
      }
      const effectiveClearance =
        earning.holdExtendedUntil && earning.holdExtendedUntil > earning.clearsAt
          ? earning.holdExtendedUntil
          : earning.clearsAt;
      if (input.action === 'extend_clearance') {
        if (!input.holdUntil || input.holdUntil <= effectiveClearance) {
          throw new BadRequestException(
            'holdUntil must be later than the current effective clearance',
          );
        }
        await transaction.taskerEarning.update({
          where: { id: earning.id },
          data: {
            holdExtendedUntil: input.holdUntil,
            ...(earning.isBlocked
              ? {}
              : { blockReason: input.reason, blockedAt: new Date() }),
          },
        });
      } else if (input.action === 'block') {
        await transaction.taskerEarning.update({
          where: { id: earning.id },
          data: { isBlocked: true, blockReason: input.reason, blockedAt: new Date() },
        });
      } else {
        const [activeDisputes, providerDisputes] = await Promise.all([
          transaction.taskComplaint.count({
            where: {
              bookingId: earning.bookingId,
              status: { in: ['open', 'under_investigation', 'escalated'] },
            },
          }),
          transaction.stripeChargeback.count({
            where: {
              bookingId: earning.bookingId,
              status: {
                in: [
                  'warning_needs_response',
                  'warning_under_review',
                  'needs_response',
                  'under_review',
                  'lost',
                ],
              },
            },
          }),
        ]);
        if (activeDisputes > 0 || providerDisputes > 0) {
          throw new ConflictException(
            providerDisputes > 0
              ? 'The earning cannot be unblocked while a Stripe chargeback requires review'
              : 'The earning cannot be unblocked while a booking dispute is active',
          );
        }
        await transaction.taskerEarning.update({
          where: { id: earning.id },
          data: { isBlocked: false, blockReason: null, blockedAt: null },
        });
      }
      await transaction.adminAuditLog.create({
        data: {
          actorId: input.actorId,
          targetUserId: earning.taskerId,
          action: `tasker_earning_${input.action}`,
          entityType: 'tasker_earning',
          entityId: earning.id,
          reason: input.reason,
          metadata: input.holdUntil ? { holdUntil: input.holdUntil.toISOString() } : undefined,
        },
      });
      await this.notifications.create(
        earning.taskerId,
        {
          category: 'wallet',
          type:
            input.action === 'unblock' ? 'booking_earning_unblocked' : 'booking_earning_blocked',
          title:
            input.action === 'unblock' ? 'Earning clearance resumed' : 'Earning clearance paused',
          body: input.reason,
          entityType: 'tasker_earning',
          entityId: earning.id,
        },
        transaction,
      );
      return this.serializeEarning(
        await transaction.taskerEarning.findUniqueOrThrow({ where: { id: earning.id } }),
      );
    });
  }

  async platformAccount(taskerId: number) {
    const [account, wallet] = await Promise.all([
      this.prisma.taskerPlatformAccount.findUnique({ where: { taskerId } }),
      this.prisma.taskerWallet.findUnique({ where: { taskerId }, select: { currency: true } }),
    ]);
    const currency = account?.currency ?? wallet?.currency ?? 'USD';
    return {
      outstandingPlatformPayable: {
        amount: money(account?.outstandingPayable),
        currency,
      },
      cashBookingsRestricted: account?.cashBookingsRestricted ?? false,
      restrictionReason: account?.restrictionReason ?? null,
      restrictionUpdatedAt: account?.restrictionUpdatedAt?.toISOString() ?? null,
    };
  }

  async taskerPlatformPayables(taskerId: number, query: EarningListQuery) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const [account, receivables, totalItems, ledger] = await Promise.all([
      this.platformAccount(taskerId),
      this.prisma.taskerPlatformReceivable.findMany({
        where: { taskerId },
        include: {
          booking: {
            select: { id: true, service: { select: { id: true, name: true, slug: true } } },
          },
        },
        orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.taskerPlatformReceivable.count({ where: { taskerId } }),
      this.prisma.taskerPlatformLedgerEntry.findMany({
        where: { taskerId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
      }),
    ]);
    return {
      ...account,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      receivables: receivables.map((item) => this.serializeReceivable(item)),
      ledger: ledger.map((entry) => ({
        id: entry.id,
        bookingId: entry.bookingId ? String(entry.bookingId) : null,
        receivableId: entry.receivableId,
        earningId: entry.earningId,
        kind: entry.kind,
        status: entry.status,
        amount: money(entry.amount),
        payableDelta: money(entry.payableDelta),
        currency: entry.currency,
        description: entry.description,
        externalReference: entry.externalReference,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  private async applyRestrictionPolicy(
    transaction: Prisma.TransactionClient,
    taskerId: number,
    outstanding: number,
    threshold: number,
    enabled: boolean,
  ): Promise<void> {
    const account = await transaction.taskerPlatformAccount.findUniqueOrThrow({
      where: { taskerId },
    });
    const shouldRestrict = enabled && threshold > 0 && outstanding >= threshold - 0.005;
    if (account.cashBookingsRestricted === shouldRestrict) return;
    const reason = shouldRestrict
      ? `Outstanding platform payable reached the configured ${account.currency} ${threshold.toFixed(2)} limit.`
      : null;
    await transaction.taskerPlatformAccount.update({
      where: { taskerId },
      data: {
        cashBookingsRestricted: shouldRestrict,
        restrictionReason: reason,
        restrictionUpdatedAt: new Date(),
      },
    });
    await this.notifications.create(
      taskerId,
      {
        category: 'wallet',
        type: shouldRestrict ? 'cash_bookings_restricted' : 'cash_bookings_unrestricted',
        title: shouldRestrict ? 'Cash bookings restricted' : 'Cash bookings restored',
        body: shouldRestrict
          ? (reason ?? 'Outstanding platform payable reached the configured limit.')
          : 'Your outstanding platform payable is below the configured restriction threshold.',
        entityType: 'tasker_platform_account',
        entityId: String(taskerId),
        metadata: { outstanding, threshold },
      },
      transaction,
    );
  }

  private serializeEarning(item: {
    id: string;
    bookingId: number;
    taskerId: number;
    paymentSource: string;
    grossCustomerAmount: Prisma.Decimal;
    serviceAmount: Prisma.Decimal;
    platformCommissionAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    serviceSurchargeAmount: Prisma.Decimal;
    tipAmount: Prisma.Decimal;
    donationAmount: Prisma.Decimal;
    taskerNetAmount: Prisma.Decimal;
    reversedAmount: Prisma.Decimal;
    debtOffsetAmount: Prisma.Decimal;
    releasedToAvailableAmount: Prisma.Decimal;
    currency: string;
    status: string;
    isBlocked: boolean;
    blockReason: string | null;
    holdExtendedUntil: Date | null;
    reversalReason: string | null;
    providerSettlementReference: string;
    settledAt: Date;
    clearsAt: Date;
    releasedAt: Date | null;
    reversedAt: Date | null;
    createdAt: Date;
    booking?: unknown;
    tasker?: unknown;
  }) {
    const effectiveClearsAt =
      item.holdExtendedUntil && item.holdExtendedUntil > item.clearsAt
        ? item.holdExtendedUntil
        : item.clearsAt;
    return {
      id: item.id,
      bookingId: String(item.bookingId),
      taskerId: String(item.taskerId),
      paymentSource: item.paymentSource,
      currency: item.currency,
      grossCustomerAmount: money(item.grossCustomerAmount),
      serviceAmount: money(item.serviceAmount),
      platformCommissionAmount: money(item.platformCommissionAmount),
      taxAmount: money(item.taxAmount),
      serviceSurchargeAmount: money(item.serviceSurchargeAmount),
      tipAmount: money(item.tipAmount),
      donationAmount: money(item.donationAmount),
      taskerNetAmount: money(item.taskerNetAmount),
      reversedAmount: money(item.reversedAmount),
      debtOffsetAmount: money(item.debtOffsetAmount),
      releasedToAvailableAmount: money(item.releasedToAvailableAmount),
      status: item.status,
      held:
        item.isBlocked || Boolean(item.holdExtendedUntil && item.holdExtendedUntil > new Date()),
      holdReason: item.blockReason,
      reversalReason: item.reversalReason,
      providerSettlementReference: item.providerSettlementReference,
      settledAt: item.settledAt.toISOString(),
      clearsAt: item.clearsAt.toISOString(),
      expectedAvailableAt: effectiveClearsAt.toISOString(),
      releasedAt: item.releasedAt?.toISOString() ?? null,
      reversedAt: item.reversedAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
      ...('booking' in item ? { booking: item.booking } : {}),
      ...('tasker' in item ? { tasker: item.tasker } : {}),
    };
  }

  private serializeReceivable(item: {
    id: string;
    bookingId: number;
    taskerId: number;
    cashCollectedAmount: Prisma.Decimal;
    serviceAmount: Prisma.Decimal;
    platformCommissionAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    serviceSurchargeAmount: Prisma.Decimal;
    tipAmount: Prisma.Decimal;
    donationAmount: Prisma.Decimal;
    taskerEconomicEarning: Prisma.Decimal;
    originalPayableAmount: Prisma.Decimal;
    outstandingAmount: Prisma.Decimal;
    settledAmount: Prisma.Decimal;
    reversedAmount: Prisma.Decimal;
    currency: string;
    status: string;
    isDisputed: boolean;
    disputeBlockReason: string | null;
    disputeClearsAt: Date;
    clearedAt: Date | null;
    confirmedAt: Date;
    settledAt: Date | null;
    booking?: unknown;
    tasker?: unknown;
  }) {
    return {
      id: item.id,
      bookingId: String(item.bookingId),
      taskerId: String(item.taskerId),
      cashCollectedAmount: money(item.cashCollectedAmount),
      serviceAmount: money(item.serviceAmount),
      platformCommissionAmount: money(item.platformCommissionAmount),
      taxAmount: money(item.taxAmount),
      serviceSurchargeAmount: money(item.serviceSurchargeAmount),
      tipAmount: money(item.tipAmount),
      donationAmount: money(item.donationAmount),
      taskerEconomicEarning: money(item.taskerEconomicEarning),
      originalPayableAmount: money(item.originalPayableAmount),
      outstandingAmount: money(item.outstandingAmount),
      settledAmount: money(item.settledAmount),
      reversedAmount: money(item.reversedAmount),
      currency: item.currency,
      status: item.status,
      disputed: item.isDisputed,
      disputeBlockReason: item.disputeBlockReason,
      disputeClearsAt: item.disputeClearsAt.toISOString(),
      clearedAt: item.clearedAt?.toISOString() ?? null,
      confirmedAt: item.confirmedAt.toISOString(),
      settledAt: item.settledAt?.toISOString() ?? null,
      physicalPossession: 'tasker',
      ...('booking' in item ? { booking: item.booking } : {}),
      ...('tasker' in item ? { tasker: item.tasker } : {}),
    };
  }
}
