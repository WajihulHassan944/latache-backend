import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type Stripe from 'stripe';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type TaskerPlatformSettlement } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StripeService } from '../payments/stripe.service';
import { WALLET_ENTRY_KIND } from '../tasker-dashboard/tasker-dashboard.constants';
import { TaskerFinanceService } from './tasker-finance.service';

export const SETTLEMENT_STATUS = {
  /** Card PaymentIntent created; waiting for the Tasker to confirm it in-app. */
  PendingPayment: 'pending_payment',
  /** Offline payment declared by the Tasker; waiting for finance to confirm receipt. */
  PendingReview: 'pending_review',
  Completed: 'completed',
  Rejected: 'rejected',
  Cancelled: 'cancelled',
} as const;

export const TASKER_SETTLEMENT_METHODS = ['wallet', 'stripe', 'bank_transfer'] as const;
export const ADMIN_SETTLEMENT_METHODS = ['bank_transfer', 'cash_deposit', 'other'] as const;
export const SETTLEMENT_INTENT_KIND = 'platform_payable_settlement';

const OPEN = [SETTLEMENT_STATUS.PendingPayment, SETTLEMENT_STATUS.PendingReview] as string[];
const money = (value: Prisma.Decimal | number | string | null | undefined): number =>
  Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
const toMinor = (value: number): number => Math.round(money(value) * 100);

export interface SettlementView {
  id: string;
  taskerId: string;
  method: string;
  status: string;
  amount: number;
  appliedAmount: number;
  overpaymentAmount: number;
  currency: string;
  externalReference: string | null;
  note: string | null;
  adminNote: string | null;
  failureReason: string | null;
  clientSecret?: string | null;
  createdAt: string;
  reviewedAt: string | null;
  completedAt: string | null;
}

/**
 * How a Tasker pays Latache the commission owed on cash bookings (the payable
 * TaskerFinanceService records at cash confirmation). Before this, the payable
 * could only shrink through the automatic offset of future ONLINE earnings, so a
 * cash-only Tasker had no way to pay at all.
 *
 * Every completion goes through TaskerFinanceService.applyPayableSettlement in the
 * same transaction as the status change, so balances, receivables, ledger and the
 * cash restriction always move together. All creates are idempotent per
 * (tasker, Idempotency-Key); every state change is audited.
 */
@Injectable()
export class PlatformPayableSettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly finance: TaskerFinanceService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly stripe: StripeService,
  ) {}

  // ------------------------------------------------------------------ tasker

  async create(
    taskerId: number,
    input: { method: string; amount?: number; reference?: string; note?: string },
    idempotencyKey: string,
  ): Promise<SettlementView> {
    const key = this.requireKey(idempotencyKey);
    const replay = await this.prisma.taskerPlatformSettlement.findUnique({
      where: { taskerId_idempotencyKey: { taskerId, idempotencyKey: key } },
    });
    if (replay) return this.replay(replay, input);
    if (!(TASKER_SETTLEMENT_METHODS as readonly string[]).includes(input.method)) {
      throw new BadRequestException(`method must be one of ${TASKER_SETTLEMENT_METHODS.join(', ')}`);
    }
    if (input.method === 'bank_transfer' && !input.reference?.trim()) {
      throw new BadRequestException('reference (the bank transfer reference) is required for bank_transfer');
    }

    let settlement: TaskerPlatformSettlement;
    try {
      settlement = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "Users" WHERE "id" = ${taskerId} FOR UPDATE`;
        const account = await transaction.taskerPlatformAccount.findUnique({ where: { taskerId } });
        const outstanding = money(account?.outstandingPayable);
        if (!account || outstanding <= 0) {
          throw new ConflictException({ code: 'NOTHING_TO_SETTLE', message: 'You have no outstanding platform payable' });
        }
        const amount = money(input.amount ?? outstanding);
        if (amount <= 0) throw new BadRequestException('amount must be positive');
        if (amount > outstanding + 0.005) {
          throw new ConflictException({
            code: 'AMOUNT_EXCEEDS_OUTSTANDING',
            message: `amount exceeds the outstanding payable of ${account.currency} ${outstanding.toFixed(2)}`,
          });
        }
        const open = await transaction.taskerPlatformSettlement.findFirst({
          where: { taskerId, status: { in: OPEN } },
          select: { id: true, status: true },
        });
        if (open) {
          throw new ConflictException({
            code: 'SETTLEMENT_ALREADY_PENDING',
            message: `Settlement ${open.id} is still ${open.status}; complete or cancel it first`,
            settlementId: open.id,
          });
        }
        const row = await transaction.taskerPlatformSettlement.create({
          data: {
            taskerId,
            method: input.method,
            status:
              input.method === 'wallet'
                ? SETTLEMENT_STATUS.Completed
                : input.method === 'stripe'
                  ? SETTLEMENT_STATUS.PendingPayment
                  : SETTLEMENT_STATUS.PendingReview,
            amount: amount.toFixed(2),
            currency: account.currency,
            idempotencyKey: key,
            externalReference: input.reference?.trim() || null,
            note: input.note?.trim() || null,
            createdById: taskerId,
          },
        });
        if (input.method === 'wallet') await this.payFromWallet(row, transaction);
        await this.audit.record(
          { actorId: taskerId, targetUserId: taskerId, action: 'platform_payable_settlement_created', entityType: 'tasker_platform_settlement', entityId: row.id, metadata: { method: row.method, amount, currency: row.currency } },
          transaction,
        );
        return transaction.taskerPlatformSettlement.findUniqueOrThrow({ where: { id: row.id } });
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        const raced = await this.prisma.taskerPlatformSettlement.findUnique({
          where: { taskerId_idempotencyKey: { taskerId, idempotencyKey: key } },
        });
        if (raced) return this.replay(raced, input);
      }
      throw error;
    }

    if (settlement.method !== 'stripe') return this.view(settlement);
    // Card: the PaymentIntent is created outside the DB transaction (network call),
    // idempotently keyed by the settlement id. The verified webhook completes it.
    try {
      const intent = await this.stripe.client().paymentIntents.create(
        {
          amount: toMinor(money(settlement.amount)),
          currency: settlement.currency.toLowerCase(),
          payment_method_types: ['card'],
          description: `Latache platform payable settlement ${settlement.id}`,
          metadata: { kind: SETTLEMENT_INTENT_KIND, latacheSettlementId: settlement.id, latacheTaskerId: String(taskerId) },
        },
        { idempotencyKey: `latache:platform-settlement:${settlement.id}` },
      );
      const updated = await this.prisma.taskerPlatformSettlement.update({
        where: { id: settlement.id },
        data: { providerReference: intent.id },
      });
      return { ...this.view(updated), clientSecret: intent.client_secret };
    } catch (error) {
      await this.prisma.taskerPlatformSettlement.update({
        where: { id: settlement.id },
        data: { status: SETTLEMENT_STATUS.Cancelled, failureReason: error instanceof Error ? error.message.slice(0, 1000) : 'Stripe error' },
      });
      throw error;
    }
  }

  async cancel(taskerId: number, id: string): Promise<SettlementView> {
    const row = await this.prisma.taskerPlatformSettlement.findUnique({ where: { id } });
    if (!row || row.taskerId !== taskerId) throw new NotFoundException('Settlement not found');
    if (!OPEN.includes(row.status)) throw new ConflictException(`This settlement is already ${row.status}`);
    if (row.status === SETTLEMENT_STATUS.PendingPayment && row.providerReference) {
      const intent = await this.stripe.client().paymentIntents.retrieve(row.providerReference);
      if (intent.status === 'succeeded' || intent.status === 'processing') {
        throw new ConflictException('This card payment has already been submitted and cannot be cancelled');
      }
      if (intent.status !== 'canceled') {
        await this.stripe.client().paymentIntents.cancel(row.providerReference).catch(() => undefined);
      }
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      const locked = await this.lock(id, transaction);
      if (!OPEN.includes(locked.status)) throw new ConflictException(`This settlement is already ${locked.status}`);
      const next = await transaction.taskerPlatformSettlement.update({
        where: { id },
        data: { status: SETTLEMENT_STATUS.Cancelled },
      });
      await this.audit.record(
        { actorId: taskerId, targetUserId: taskerId, action: 'platform_payable_settlement_cancelled', entityType: 'tasker_platform_settlement', entityId: id },
        transaction,
      );
      return next;
    });
    return this.view(updated);
  }

  async list(where: Prisma.TaskerPlatformSettlementWhereInput, page?: number, limit?: number) {
    const paging = normalizePagination(page, limit, 20);
    const [rows, totalItems] = await Promise.all([
      this.prisma.taskerPlatformSettlement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: paging.offset,
        take: paging.limit,
      }),
      this.prisma.taskerPlatformSettlement.count({ where }),
    ]);
    return {
      page: paging.page,
      limit: paging.limit,
      totalItems,
      totalPages: Math.ceil(totalItems / paging.limit),
      items: rows.map((row) => this.view(row)),
    };
  }

  async get(taskerId: number, id: string): Promise<SettlementView> {
    const row = await this.prisma.taskerPlatformSettlement.findUnique({ where: { id } });
    if (!row || row.taskerId !== taskerId) throw new NotFoundException('Settlement not found');
    return this.view(row);
  }

  // ------------------------------------------------------------------- admin

  /** Finance records money it has actually received offline (completed immediately). */
  async adminRecord(
    adminId: number,
    input: { taskerId: number; amount: number; method: string; reference: string; note?: string },
    idempotencyKey: string,
  ): Promise<SettlementView> {
    const key = `admin:${this.requireKey(idempotencyKey)}`;
    const replay = await this.prisma.taskerPlatformSettlement.findUnique({
      where: { taskerId_idempotencyKey: { taskerId: input.taskerId, idempotencyKey: key } },
    });
    if (replay) return this.replay(replay, input);
    if (!(ADMIN_SETTLEMENT_METHODS as readonly string[]).includes(input.method)) {
      throw new BadRequestException(`method must be one of ${ADMIN_SETTLEMENT_METHODS.join(', ')}`);
    }
    const account = await this.prisma.taskerPlatformAccount.findUnique({ where: { taskerId: input.taskerId } });
    if (!account) throw new NotFoundException('This Tasker has no platform payable account');
    try {
      const row = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.taskerPlatformSettlement.create({
          data: {
            taskerId: input.taskerId,
            method: input.method,
            status: SETTLEMENT_STATUS.Completed,
            amount: money(input.amount).toFixed(2),
            currency: account.currency,
            idempotencyKey: key,
            externalReference: input.reference.trim(),
            adminNote: input.note?.trim() || null,
            createdById: adminId,
            reviewedById: adminId,
            reviewedAt: new Date(),
          },
        });
        await this.complete(created, money(input.amount), transaction);
        await this.audit.record(
          { actorId: adminId, targetUserId: input.taskerId, action: 'platform_payable_settlement_recorded', entityType: 'tasker_platform_settlement', entityId: created.id, reason: input.note ?? null, metadata: { method: input.method, amount: money(input.amount), reference: input.reference } },
          transaction,
        );
        return transaction.taskerPlatformSettlement.findUniqueOrThrow({ where: { id: created.id } });
      });
      return this.view(row);
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        const raced = await this.prisma.taskerPlatformSettlement.findUnique({
          where: { taskerId_idempotencyKey: { taskerId: input.taskerId, idempotencyKey: key } },
        });
        if (raced) return this.replay(raced, input);
      }
      throw error;
    }
  }

  /** Finance confirms a Tasker-declared bank transfer arrived (optionally for a different received amount). */
  async approve(adminId: number, id: string, input: { receivedAmount?: number; note?: string }): Promise<SettlementView> {
    const row = await this.prisma.$transaction(async (transaction) => {
      const locked = await this.lock(id, transaction);
      if (locked.status !== SETTLEMENT_STATUS.PendingReview) {
        throw new ConflictException(`Only a pending_review settlement can be approved (status: ${locked.status})`);
      }
      const received = money(input.receivedAmount ?? locked.amount);
      if (received <= 0) throw new BadRequestException('receivedAmount must be positive');
      await transaction.taskerPlatformSettlement.update({
        where: { id },
        data: { status: SETTLEMENT_STATUS.Completed, amount: received.toFixed(2), reviewedById: adminId, reviewedAt: new Date(), adminNote: input.note?.trim() || null },
      });
      await this.complete({ ...locked, amount: new Prisma.Decimal(received) }, received, transaction);
      await this.audit.record(
        { actorId: adminId, targetUserId: locked.taskerId, action: 'platform_payable_settlement_approved', entityType: 'tasker_platform_settlement', entityId: id, reason: input.note ?? null, metadata: { declaredAmount: money(locked.amount), receivedAmount: received } },
        transaction,
      );
      return transaction.taskerPlatformSettlement.findUniqueOrThrow({ where: { id } });
    });
    return this.view(row);
  }

  async reject(adminId: number, id: string, note: string): Promise<SettlementView> {
    const row = await this.prisma.$transaction(async (transaction) => {
      const locked = await this.lock(id, transaction);
      if (locked.status !== SETTLEMENT_STATUS.PendingReview) {
        throw new ConflictException(`Only a pending_review settlement can be rejected (status: ${locked.status})`);
      }
      const updated = await transaction.taskerPlatformSettlement.update({
        where: { id },
        data: { status: SETTLEMENT_STATUS.Rejected, reviewedById: adminId, reviewedAt: new Date(), adminNote: note.trim() },
      });
      await this.notifications.create(
        locked.taskerId,
        {
          category: 'wallet',
          type: 'platform_payable_settlement_rejected',
          title: 'Payment to Latache not confirmed',
          body: `We could not confirm your ${locked.currency} ${money(locked.amount).toFixed(2)} payment (${locked.externalReference ?? 'no reference'}). Reason: ${note.trim()}`,
          entityType: 'tasker_platform_settlement',
          entityId: id,
          audienceRole: UserRole.Tasker,
        },
        transaction,
      );
      await this.audit.record(
        { actorId: adminId, targetUserId: locked.taskerId, action: 'platform_payable_settlement_rejected', entityType: 'tasker_platform_settlement', entityId: id, reason: note },
        transaction,
      );
      return updated;
    });
    return this.view(row);
  }

  // ----------------------------------------------------------------- webhook

  /** Called from PaymentsService.handleStripeEvent inside its webhook transaction. */
  async handleIntent(
    transaction: Prisma.TransactionClient,
    intent: Stripe.PaymentIntent,
    eventType: string,
  ): Promise<void> {
    const id = intent.metadata.latacheSettlementId;
    if (!id) throw new BadRequestException('Stripe settlement metadata is invalid');
    const locked = await this.lock(id, transaction);
    if (eventType === 'payment_intent.payment_failed') {
      await transaction.taskerPlatformSettlement.update({
        where: { id },
        data: { failureReason: intent.last_payment_error?.message ?? 'Card payment failed' },
      });
      return;
    }
    if (eventType !== 'payment_intent.succeeded' || locked.status === SETTLEMENT_STATUS.Completed) return;
    // Even a settlement the Tasker cancelled is honored if Stripe actually took the money.
    const received = money((intent.amount_received || intent.amount) / 100);
    await transaction.taskerPlatformSettlement.update({
      where: { id },
      data: { status: SETTLEMENT_STATUS.Completed, amount: received.toFixed(2), providerReference: intent.id, failureReason: null },
    });
    await this.complete({ ...locked, amount: new Prisma.Decimal(received) }, received, transaction);
  }

  // ----------------------------------------------------------------- helpers

  private async payFromWallet(row: TaskerPlatformSettlement, transaction: Prisma.TransactionClient) {
    const amount = money(row.amount);
    await transaction.taskerWallet.upsert({
      where: { taskerId: row.taskerId },
      create: { taskerId: row.taskerId, currency: row.currency },
      update: {},
    });
    await transaction.$queryRaw`SELECT "taskerId" FROM "TaskerWallets" WHERE "taskerId" = ${row.taskerId} FOR UPDATE`;
    const wallet = await transaction.taskerWallet.findUniqueOrThrow({ where: { taskerId: row.taskerId } });
    if (wallet.currency !== row.currency) {
      throw new ConflictException('Wallet currency does not match the platform payable');
    }
    if (money(wallet.availableBalance) + 0.005 < amount) {
      throw new HttpException(
        { statusCode: HttpStatus.PAYMENT_REQUIRED, code: 'INSUFFICIENT_WALLET_BALANCE', message: `Available wallet balance ${wallet.currency} ${money(wallet.availableBalance).toFixed(2)} is below ${amount.toFixed(2)}` },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
    await transaction.taskerWallet.update({
      where: { taskerId: row.taskerId },
      data: { availableBalance: { decrement: amount.toFixed(2) } },
    });
    await transaction.taskerWalletLedgerEntry.create({
      data: {
        taskerId: row.taskerId,
        kind: WALLET_ENTRY_KIND.PlatformPayableSettlement,
        status: 'settled',
        amount: amount.toFixed(2),
        availableDelta: (-amount).toFixed(2),
        pendingDelta: '0.00',
        currency: row.currency,
        description: `Platform payable paid from wallet (settlement ${row.id})`,
        externalReference: row.id,
        idempotencyKey: `settlement:${row.id}:wallet-debit`,
      },
    });
    await this.complete(row, amount, transaction);
  }

  private async complete(row: TaskerPlatformSettlement, amount: number, transaction: Prisma.TransactionClient) {
    const result = await this.finance.applyPayableSettlement(transaction, {
      taskerId: row.taskerId,
      settlementId: row.id,
      amount,
      currency: row.currency,
      reference: row.providerReference ?? row.externalReference ?? row.id,
    });
    await transaction.taskerPlatformSettlement.update({
      where: { id: row.id },
      data: {
        appliedAmount: result.applied.toFixed(2),
        overpaymentAmount: result.overpayment.toFixed(2),
        completedAt: new Date(),
      },
    });
    await this.notifications.create(
      row.taskerId,
      {
        category: 'wallet',
        type: 'platform_payable_settlement_completed',
        title: 'Payment to Latache received',
        body:
          `${row.currency} ${result.applied.toFixed(2)} was applied to your platform payable; ${row.currency} ${result.outstandingAfter.toFixed(2)} remains outstanding.` +
          (result.overpayment > 0 ? ` ${row.currency} ${result.overpayment.toFixed(2)} above the balance was credited to your wallet.` : ''),
        entityType: 'tasker_platform_settlement',
        entityId: row.id,
        metadata: { applied: result.applied, overpayment: result.overpayment, outstandingAfter: result.outstandingAfter },
        audienceRole: UserRole.Tasker,
      },
      transaction,
    );
  }

  private async lock(id: string, transaction: Prisma.TransactionClient) {
    await transaction.$queryRaw`SELECT "id" FROM "TaskerPlatformSettlements" WHERE "id" = ${id} FOR UPDATE`;
    const row = await transaction.taskerPlatformSettlement.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Settlement not found');
    return row;
  }

  private requireKey(value: string): string {
    const key = value?.trim();
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    if (key.length > 100) throw new BadRequestException('Idempotency-Key must be at most 100 characters');
    return key;
  }

  /** Same key + same parameters returns the original; same key + different parameters is refused. */
  private async replay(row: TaskerPlatformSettlement, input: { method: string; amount?: number }) {
    if (row.method !== input.method || (input.amount !== undefined && money(input.amount) !== money(row.amount) && row.status !== SETTLEMENT_STATUS.Completed)) {
      throw new ConflictException('This Idempotency-Key was already used with different parameters');
    }
    if (row.method === 'stripe' && row.status === SETTLEMENT_STATUS.PendingPayment && row.providerReference) {
      const intent = await this.stripe.client().paymentIntents.retrieve(row.providerReference);
      return { ...this.view(row), clientSecret: intent.client_secret };
    }
    return this.view(row);
  }

  view(row: TaskerPlatformSettlement): SettlementView {
    return {
      id: row.id,
      taskerId: String(row.taskerId),
      method: row.method,
      status: row.status,
      amount: money(row.amount),
      appliedAmount: money(row.appliedAmount),
      overpaymentAmount: money(row.overpaymentAmount),
      currency: row.currency,
      externalReference: row.externalReference,
      note: row.note,
      adminNote: row.adminNote,
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
    };
  }
}
