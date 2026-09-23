import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type TaskerSubscription } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentsService } from '../payments/payments.service';
import { PLATFORM_CURRENCY_PRESETS } from '../platform-settings/platform-currency.presets';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { WALLET_ENTRY_KIND } from '../tasker-dashboard/tasker-dashboard.constants';
import {
  PLAN_PRICE_CURRENCY,
  TASKER_PLAN_IDS,
  TASKER_PLAN_PERIOD_DAYS,
  TASKER_PLAN_STATUS,
  TASKER_PLANS,
  isTaskerPlanId,
  type TaskerPlanDefinition,
  type TaskerPlanId,
} from './tasker-plans.constants';
import type { ListTaskerSubscriptionsDto } from './tasker-plans.dto';

const DAY_MS = 86_400_000;
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const OPEN_STATUSES = [TASKER_PLAN_STATUS.Pending, TASKER_PLAN_STATUS.Active];

export interface ActiveTaskerPlanPerks {
  planId: TaskerPlanId;
  platformFeePercent: number;
  searchPriorityRank: number;
  badge: TaskerPlanId;
}

/**
 * Paid Gold/Platinum/Diamond subscriptions a Tasker buys directly. Deliberately
 * separate from the earned Elite tier system (EliteProgramService): different
 * table, different lifecycle, perks resolved independently.
 *
 * Lifecycle: purchase (paid up front) -> pending -> admin approve -> active
 * (perks on, first bonus paid, 30-day period) -> auto-renew on the same method
 * each period -> on renewal failure, perks stay on for a grace period with daily
 * retries -> expired (perks off). Admin reject refunds the purchase.
 */
@Injectable()
export class TaskerPlansService {
  private readonly logger = new Logger(TaskerPlansService.name);
  private readonly graceDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly config: ConfigService,
  ) {
    this.graceDays = config.get<number>('taskerPlans.graceDays', 3);
  }

  catalog() {
    return {
      currency: PLAN_PRICE_CURRENCY,
      periodDays: TASKER_PLAN_PERIOD_DAYS,
      plans: TASKER_PLAN_IDS.map((id) => TASKER_PLANS[id]),
    };
  }

  async active(taskerId: number): Promise<{ planId: TaskerPlanId | null; status: 'pending' | 'active' | null }> {
    const row = await this.prisma.taskerSubscription.findFirst({
      where: { taskerId, status: { in: OPEN_STATUSES } },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return { planId: null, status: null };
    return { planId: row.planId as TaskerPlanId, status: row.status as 'pending' | 'active' };
  }

  /** Perks for pricing/discovery. Only an approved (active) plan counts, never a pending one. */
  async activePerks(
    taskerId: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<ActiveTaskerPlanPerks | null> {
    const db = transaction ?? this.prisma;
    const row = await db.taskerSubscription.findFirst({
      where: { taskerId, status: TASKER_PLAN_STATUS.Active },
      select: { planId: true },
    });
    if (!row || !isTaskerPlanId(row.planId)) return null;
    const plan = TASKER_PLANS[row.planId];
    return {
      planId: plan.id,
      platformFeePercent: plan.platformFeePercent,
      searchPriorityRank: plan.searchPriorityRank,
      badge: plan.badge,
    };
  }

  async purchase(taskerId: number, planIdInput: string, paymentMethodInput: string) {
    if (!isTaskerPlanId(planIdInput)) throw new NotFoundException('Plan not found');
    const plan = TASKER_PLANS[planIdInput];
    const method = paymentMethodInput.trim();
    const row =
      method === 'wallet'
        ? await this.purchaseWithWallet(taskerId, plan)
        : await this.purchaseWithCard(taskerId, plan, method === 'stripe' ? null : method);
    return {
      success: true as const,
      planId: plan.id,
      status: 'pending' as const,
      // The plan is NOT active yet (it awaits admin review); this is the moment
      // the purchase was paid and submitted.
      activatedAt: row.purchasedAt.toISOString(),
    };
  }

  private async purchaseWithWallet(taskerId: number, plan: TaskerPlanDefinition) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await this.lockTaskerAndAssertNoOpenPlan(taskerId, transaction);
        const wallet = await this.lockTaskerWallet(taskerId, transaction);
        const amount = this.priceIn(plan.monthlyPrice, wallet.currency);
        if (Number(wallet.availableBalance) < amount) {
          throw this.paymentRequired('Wallet balance is insufficient for this plan');
        }
        const row = await transaction.taskerSubscription.create({
          data: {
            taskerId,
            planId: plan.id,
            status: TASKER_PLAN_STATUS.Pending,
            priceAmount: amount.toFixed(2),
            currency: wallet.currency,
            paymentMethod: 'wallet',
          },
        });
        await this.debitWallet(taskerId, wallet.currency, amount, `plan-purchase:${row.id}`, `${plan.name} plan purchase`, transaction);
        await transaction.taskerSubscription.update({
          where: { id: row.id },
          data: { paymentReference: `wallet:plan-purchase:${row.id}` },
        });
        await this.afterPurchase(taskerId, row, plan, transaction);
        return row;
      });
    } catch (error) {
      throw this.mapOpenPlanRace(error);
    }
  }

  private async purchaseWithCard(
    taskerId: number,
    plan: TaskerPlanDefinition,
    paymentMethodId: string | null,
  ) {
    const currency = (await this.platformSettings.currencyContext()).code;
    const amount = this.priceIn(plan.monthlyPrice, currency);
    // Reserve the one-open-plan slot before touching Stripe so two concurrent
    // purchases can never both charge the card.
    let row: TaskerSubscription;
    try {
      row = await this.prisma.$transaction(async (transaction) => {
        await this.lockTaskerAndAssertNoOpenPlan(taskerId, transaction);
        return transaction.taskerSubscription.create({
          data: {
            taskerId,
            planId: plan.id,
            status: TASKER_PLAN_STATUS.Pending,
            priceAmount: amount.toFixed(2),
            currency,
            paymentMethod: 'stripe',
            stripePaymentMethodId: paymentMethodId,
          },
        });
      });
    } catch (error) {
      throw this.mapOpenPlanRace(error);
    }

    let charge: { paymentIntentId: string; paymentMethodId: string };
    try {
      charge = await this.payments.chargeSavedCardOffSession({
        userId: taskerId,
        paymentMethodId,
        amount,
        currency,
        description: `Latache ${plan.name} Tasker plan`,
        idempotencyKey: `latache:tasker-plan-purchase:${row.id}`,
        metadata: { kind: 'tasker_plan_purchase', latacheSubscriptionId: row.id, latacheTaskerId: String(taskerId) },
      });
    } catch (error) {
      await this.prisma.taskerSubscription.update({
        where: { id: row.id },
        data: {
          status: TASKER_PLAN_STATUS.PaymentFailed,
          endedAt: new Date(),
          renewalFailureReason: error instanceof Error ? error.message.slice(0, 500) : 'Card charge failed',
        },
      });
      throw error;
    }

    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.taskerSubscription.update({
        where: { id: row.id },
        data: { paymentReference: charge.paymentIntentId, stripePaymentMethodId: charge.paymentMethodId },
      });
      await this.afterPurchase(taskerId, updated, plan, transaction);
      return updated;
    });
  }

  private async afterPurchase(
    taskerId: number,
    row: TaskerSubscription,
    plan: TaskerPlanDefinition,
    transaction: Prisma.TransactionClient,
  ) {
    await this.notifications.create(
      taskerId,
      {
        category: 'payments',
        type: 'tasker_plan_purchased',
        title: `${plan.name} plan submitted`,
        body: `Your ${plan.name} plan payment of ${row.currency} ${Number(row.priceAmount).toFixed(2)} was received and is awaiting review. Perks start once it is approved.`,
        entityType: 'tasker_subscription',
        entityId: row.id,
        metadata: { subscriptionId: row.id, planId: plan.id },
        audienceRole: UserRole.Tasker,
      },
      transaction,
    );
    await this.audit.record(
      {
        actorId: taskerId,
        targetUserId: taskerId,
        action: 'tasker_plan_purchased',
        entityType: 'tasker_subscription',
        entityId: row.id,
        metadata: { planId: plan.id, amount: Number(row.priceAmount), currency: row.currency, paymentMethod: row.paymentMethod },
      },
      transaction,
    );
  }

  // ---------------------------------------------------------------- admin

  async adminList(query: ListTaskerSubscriptionsDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const where: Prisma.TaskerSubscriptionWhereInput = query.status ? { status: query.status } : {};
    const [rows, totalItems] = await Promise.all([
      this.prisma.taskerSubscription.findMany({
        where,
        include: { tasker: { select: { id: true, firstName: true, lastName: true, email: true, profilePicture: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.taskerSubscription.count({ where }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        ...this.adminView(row),
        tasker: {
          id: String(row.tasker.id),
          name: `${row.tasker.firstName ?? ''} ${row.tasker.lastName ?? ''}`.trim(),
          email: row.tasker.email,
          avatar: row.tasker.profilePicture ?? '',
        },
      })),
    };
  }

  async approve(adminId: number, subscriptionId: string, note?: string) {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await this.lockSubscription(subscriptionId, transaction);
      if (row.status !== TASKER_PLAN_STATUS.Pending || !row.paymentReference) {
        throw new ConflictException(`Only a paid pending plan can be approved (status: ${row.status})`);
      }
      const plan = this.planOf(row);
      const now = new Date();
      await transaction.taskerSubscription.update({
        where: { id: row.id },
        data: {
          status: TASKER_PLAN_STATUS.Active,
          activatedAt: now,
          currentPeriodEnd: new Date(now.getTime() + TASKER_PLAN_PERIOD_DAYS * DAY_MS),
          reviewedById: adminId,
          reviewedAt: now,
          adminNote: note ?? null,
        },
      });
      await this.payBonus(row.taskerId, row.id, plan, now, transaction);
      await this.notifications.create(
        row.taskerId,
        {
          category: 'payments',
          type: 'tasker_plan_activated',
          title: `${plan.name} plan active`,
          body: `Your ${plan.name} plan is now active: ${plan.platformFeePercent}% platform fee, priority placement and your ${PLAN_PRICE_CURRENCY} ${plan.monthlyBonus} monthly bonus have been applied.`,
          entityType: 'tasker_subscription',
          entityId: row.id,
          metadata: { subscriptionId: row.id, planId: plan.id },
          audienceRole: UserRole.Tasker,
        },
        transaction,
      );
      await this.audit.record(
        { actorId: adminId, targetUserId: row.taskerId, action: 'tasker_plan_approved', entityType: 'tasker_subscription', entityId: row.id, reason: note ?? null, metadata: { planId: plan.id } },
        transaction,
      );
      return transaction.taskerSubscription.findUniqueOrThrow({ where: { id: row.id } });
    });
    return this.adminView(updated);
  }

  async reject(adminId: number, subscriptionId: string, note?: string) {
    const current = await this.prisma.taskerSubscription.findUnique({ where: { id: subscriptionId } });
    if (!current) throw new NotFoundException('Plan subscription not found');
    if (current.status !== TASKER_PLAN_STATUS.Pending || !current.paymentReference) {
      throw new ConflictException(`Only a paid pending plan can be rejected (status: ${current.status})`);
    }
    // Card refunds are a network call: do it first (idempotent by key), then flip state.
    let refundReference: string | null = null;
    if (current.paymentMethod === 'stripe') {
      refundReference = await this.payments.refundPaymentIntent(
        current.paymentReference,
        `latache:tasker-plan-refund:${current.id}`,
        { kind: 'tasker_plan_refund', latacheSubscriptionId: current.id },
      );
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await this.lockSubscription(subscriptionId, transaction);
      if (row.status !== TASKER_PLAN_STATUS.Pending) {
        throw new ConflictException(`Only a pending plan can be rejected (status: ${row.status})`);
      }
      const plan = this.planOf(row);
      if (row.paymentMethod === 'wallet') {
        await this.creditWallet(row.taskerId, row.currency, Number(row.priceAmount), WALLET_ENTRY_KIND.PlanRefund, `plan-refund:${row.id}`, `${plan.name} plan refund`, transaction);
      }
      const now = new Date();
      await transaction.taskerSubscription.update({
        where: { id: row.id },
        data: { status: TASKER_PLAN_STATUS.Rejected, reviewedById: adminId, reviewedAt: now, endedAt: now, adminNote: note ?? null },
      });
      await this.notifications.create(
        row.taskerId,
        {
          category: 'payments',
          type: 'tasker_plan_rejected',
          title: `${plan.name} plan not approved`,
          body: `Your ${plan.name} plan request was not approved and ${row.currency} ${Number(row.priceAmount).toFixed(2)} has been refunded to your ${row.paymentMethod === 'wallet' ? 'wallet' : 'card'}.${note ? ` Note: ${note}` : ''}`,
          entityType: 'tasker_subscription',
          entityId: row.id,
          metadata: { subscriptionId: row.id, planId: plan.id },
          audienceRole: UserRole.Tasker,
        },
        transaction,
      );
      await this.audit.record(
        { actorId: adminId, targetUserId: row.taskerId, action: 'tasker_plan_rejected', entityType: 'tasker_subscription', entityId: row.id, reason: note ?? null, metadata: { planId: plan.id, refundReference } },
        transaction,
      );
      return transaction.taskerSubscription.findUniqueOrThrow({ where: { id: row.id } });
    });
    return this.adminView(updated);
  }

  // ---------------------------------------------------------- maintenance

  /** Renews due plans on their original payment method; expires ones whose grace ran out. */
  async runMaintenance(): Promise<{ renewed: number; failed: number; expired: number }> {
    const now = new Date();
    const batchSize = this.config.get<number>('taskerPlans.batchSize', 100);
    let renewed = 0;
    let failed = 0;
    let expired = 0;

    const lapsed = await this.prisma.taskerSubscription.findMany({
      where: { status: TASKER_PLAN_STATUS.Active, graceUntil: { lte: now } },
      select: { id: true },
      take: batchSize,
    });
    for (const { id } of lapsed) {
      if (await this.expireOne(id)) expired += 1;
    }

    const due = await this.prisma.taskerSubscription.findMany({
      where: {
        status: TASKER_PLAN_STATUS.Active,
        currentPeriodEnd: { lte: now },
        OR: [{ graceUntil: null }, { graceUntil: { gt: now } }],
      },
      take: batchSize,
      orderBy: { currentPeriodEnd: 'asc' },
    });
    for (const row of due) {
      // During grace, retry at most once a day rather than on every sweep.
      if (row.graceUntil && row.updatedAt.getTime() > now.getTime() - DAY_MS) continue;
      try {
        if (await this.renewOne(row)) renewed += 1;
        else failed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(`Plan renewal ${row.id} errored: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { renewed, failed, expired };
  }

  private async renewOne(row: TaskerSubscription): Promise<boolean> {
    const plan = this.planOf(row);
    const periodEnd = row.currentPeriodEnd as Date;
    const renewalKey = `${row.id}:${periodEnd.toISOString()}`;
    let reference: string;
    try {
      if (row.paymentMethod === 'wallet') {
        reference = await this.prisma.$transaction(async (transaction) => {
          const wallet = await this.lockTaskerWallet(row.taskerId, transaction);
          const amount = this.priceIn(plan.monthlyPrice, wallet.currency);
          if (Number(wallet.availableBalance) < amount) {
            throw this.paymentRequired('Wallet balance is insufficient for the plan renewal');
          }
          await this.debitWallet(row.taskerId, wallet.currency, amount, `plan-renewal:${renewalKey}`, `${plan.name} plan renewal`, transaction);
          return `wallet:plan-renewal:${renewalKey}`;
        });
      } else {
        const charge = await this.payments.chargeSavedCardOffSession({
          userId: row.taskerId,
          paymentMethodId: row.stripePaymentMethodId,
          amount: Number(row.priceAmount),
          currency: row.currency,
          description: `Latache ${plan.name} Tasker plan renewal`,
          // One key per period per retry day: a retry after a decline is a new attempt.
          idempotencyKey: `latache:tasker-plan-renewal:${renewalKey}:${new Date().toISOString().slice(0, 10)}`,
          metadata: { kind: 'tasker_plan_renewal', latacheSubscriptionId: row.id, latacheTaskerId: String(row.taskerId) },
        });
        reference = charge.paymentIntentId;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 500) : 'Renewal charge failed';
      await this.prisma.$transaction(async (transaction) => {
        const firstFailure = !row.graceUntil;
        await transaction.taskerSubscription.update({
          where: { id: row.id },
          data: {
            renewalFailureReason: reason,
            graceUntil: row.graceUntil ?? new Date(periodEnd.getTime() + this.graceDays * DAY_MS),
          },
        });
        if (firstFailure) {
          await this.notifications.create(
            row.taskerId,
            {
              category: 'payments',
              type: 'tasker_plan_renewal_failed',
              title: `${plan.name} plan renewal failed`,
              body: `We could not renew your ${plan.name} plan (${reason}). Your perks stay active for ${this.graceDays} more days while we retry; top up your ${row.paymentMethod === 'wallet' ? 'wallet' : 'card'} to keep them.`,
              entityType: 'tasker_subscription',
              entityId: row.id,
              metadata: { subscriptionId: row.id, planId: plan.id },
              audienceRole: UserRole.Tasker,
            },
            transaction,
          );
        }
      });
      return false;
    }

    await this.prisma.$transaction(async (transaction) => {
      const locked = await this.lockSubscription(row.id, transaction);
      if (locked.status !== TASKER_PLAN_STATUS.Active) return;
      const nextEnd = new Date(periodEnd.getTime() + TASKER_PLAN_PERIOD_DAYS * DAY_MS);
      await transaction.taskerSubscription.update({
        where: { id: row.id },
        data: { currentPeriodEnd: nextEnd, graceUntil: null, renewalFailureReason: null, paymentReference: reference },
      });
      await this.payBonus(row.taskerId, row.id, plan, periodEnd, transaction);
    });
    return true;
  }

  private async expireOne(id: string): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const row = await this.lockSubscription(id, transaction);
      if (row.status !== TASKER_PLAN_STATUS.Active || !row.graceUntil || row.graceUntil > new Date()) {
        return false;
      }
      const plan = this.planOf(row);
      await transaction.taskerSubscription.update({
        where: { id },
        data: { status: TASKER_PLAN_STATUS.Expired, endedAt: new Date() },
      });
      await this.notifications.create(
        row.taskerId,
        {
          category: 'payments',
          type: 'tasker_plan_expired',
          title: `${plan.name} plan ended`,
          body: `Your ${plan.name} plan ended because the renewal payment could not be collected. Standard fees and placement now apply; you can purchase a plan again any time.`,
          entityType: 'tasker_subscription',
          entityId: id,
          metadata: { subscriptionId: id, planId: plan.id },
          audienceRole: UserRole.Tasker,
        },
        transaction,
      );
      return true;
    });
  }

  // -------------------------------------------------------------- helpers

  private async payBonus(
    taskerId: number,
    subscriptionId: string,
    plan: TaskerPlanDefinition,
    periodStart: Date,
    transaction: Prisma.TransactionClient,
  ) {
    const wallet = await this.lockTaskerWallet(taskerId, transaction);
    const amount = this.priceIn(plan.monthlyBonus, wallet.currency);
    await this.creditWallet(
      taskerId,
      wallet.currency,
      amount,
      WALLET_ENTRY_KIND.PlanBonus,
      `plan-bonus:${subscriptionId}:${periodStart.toISOString()}`,
      `${plan.name} plan monthly bonus`,
      transaction,
    );
    await transaction.taskerSubscription.update({
      where: { id: subscriptionId },
      data: { lastBonusPaidAt: new Date() },
    });
  }

  private async lockTaskerAndAssertNoOpenPlan(taskerId: number, transaction: Prisma.TransactionClient) {
    await transaction.$queryRaw`SELECT "id" FROM "Users" WHERE "id" = ${taskerId} FOR UPDATE`;
    const open = await transaction.taskerSubscription.findFirst({
      where: { taskerId, status: { in: OPEN_STATUSES } },
      select: { planId: true, status: true },
    });
    if (open) {
      throw new ConflictException({
        code: 'TASKER_PLAN_ALREADY_OPEN',
        message: `You already have a ${open.status} ${open.planId} plan`,
      });
    }
  }

  private async lockTaskerWallet(taskerId: number, transaction: Prisma.TransactionClient) {
    const currency = (await this.platformSettings.currencyContext(transaction)).code;
    await transaction.taskerWallet.upsert({
      where: { taskerId },
      create: { taskerId, currency },
      update: {},
    });
    await transaction.$queryRaw`SELECT "taskerId" FROM "TaskerWallets" WHERE "taskerId" = ${taskerId} FOR UPDATE`;
    return transaction.taskerWallet.findUniqueOrThrow({ where: { taskerId } });
  }

  private async debitWallet(
    taskerId: number,
    currency: string,
    amount: number,
    key: string,
    description: string,
    transaction: Prisma.TransactionClient,
  ) {
    await transaction.taskerWallet.update({
      where: { taskerId },
      data: { availableBalance: { decrement: amount.toFixed(2) } },
    });
    await transaction.taskerWalletLedgerEntry.create({
      data: {
        taskerId,
        kind: WALLET_ENTRY_KIND.PlanCharge,
        status: 'settled',
        amount: amount.toFixed(2),
        availableDelta: (-amount).toFixed(2),
        pendingDelta: '0.00',
        currency,
        description,
        externalReference: key,
        idempotencyKey: key,
      },
    });
  }

  private async creditWallet(
    taskerId: number,
    currency: string,
    amount: number,
    kind: string,
    key: string,
    description: string,
    transaction: Prisma.TransactionClient,
  ) {
    const existing = await transaction.taskerWalletLedgerEntry.findUnique({ where: { idempotencyKey: key } });
    if (existing || amount <= 0) return;
    await transaction.taskerWallet.update({
      where: { taskerId },
      data: { availableBalance: { increment: amount.toFixed(2) } },
    });
    await transaction.taskerWalletLedgerEntry.create({
      data: {
        taskerId,
        kind,
        status: 'settled',
        amount: amount.toFixed(2),
        availableDelta: amount.toFixed(2),
        pendingDelta: '0.00',
        currency,
        description,
        externalReference: key,
        idempotencyKey: key,
      },
    });
  }

  private async lockSubscription(id: string, transaction: Prisma.TransactionClient) {
    await transaction.$queryRaw`SELECT "id" FROM "TaskerSubscriptions" WHERE "id" = ${id} FOR UPDATE`;
    const row = await transaction.taskerSubscription.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Plan subscription not found');
    return row;
  }

  private planOf(row: TaskerSubscription): TaskerPlanDefinition {
    if (!isTaskerPlanId(row.planId)) throw new ConflictException(`Unknown plan ${row.planId}`);
    return TASKER_PLANS[row.planId];
  }

  /** Converts a PLAN_PRICE_CURRENCY amount into `currencyCode` using the platform's static rates. */
  private priceIn(amount: number, currencyCode: string): number {
    const target = currencyCode.toUpperCase();
    if (target === PLAN_PRICE_CURRENCY) return money(amount);
    const presets = Object.values(PLATFORM_CURRENCY_PRESETS);
    const source = presets.find((preset) => preset.code === PLAN_PRICE_CURRENCY);
    const destination = presets.find((preset) => preset.code === target);
    if (!source || !destination) throw new ConflictException(`Unsupported currency ${target}`);
    return money((amount / source.rateFromUsd) * destination.rateFromUsd);
  }

  private paymentRequired(message: string): HttpException {
    return new HttpException(
      { statusCode: HttpStatus.PAYMENT_REQUIRED, code: 'PAYMENT_REQUIRED', message },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }

  private mapOpenPlanRace(error: unknown): unknown {
    if (hasPrismaErrorCode(error, 'P2002')) {
      return new ConflictException({
        code: 'TASKER_PLAN_ALREADY_OPEN',
        message: 'You already have an active or pending plan',
      });
    }
    return error;
  }

  private adminView(row: TaskerSubscription) {
    return {
      id: row.id,
      taskerId: String(row.taskerId),
      planId: row.planId,
      status: row.status,
      priceAmount: Number(row.priceAmount),
      currency: row.currency,
      paymentMethod: row.paymentMethod,
      paymentReference: row.paymentReference,
      purchasedAt: row.purchasedAt.toISOString(),
      activatedAt: row.activatedAt?.toISOString() ?? null,
      nextBillingAt: row.currentPeriodEnd?.toISOString() ?? null,
      graceUntil: row.graceUntil?.toISOString() ?? null,
      renewalFailureReason: row.renewalFailureReason,
      lastBonusPaidAt: row.lastBonusPaidAt?.toISOString() ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      adminNote: row.adminNote,
      endedAt: row.endedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
