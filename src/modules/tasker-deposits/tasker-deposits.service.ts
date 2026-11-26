import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StripeService } from '../payments/stripe.service';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { InvoicesService } from '../invoices/invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';

export const DEPOSIT_STATUS = { Pending: 'pending', Paid: 'paid', Waived: 'waived', Refunded: 'refunded' } as const;
const SATISFIED = new Set<string>([DEPOSIT_STATUS.Paid, DEPOSIT_STATUS.Waived]);

type DepositRow = Prisma.TaskerDepositGetPayload<object>;

@Injectable()
export class TaskerDepositsService {
  private readonly logger = new Logger(TaskerDepositsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly invoices: InvoicesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The Tasker's deposit, created on first read while the policy requires one.
   * A still-pending deposit follows the current configured amount.
   */
  async forTasker(taskerId: number) {
    const policy = await this.settings.taskerFinancePolicy();
    const required = policy.signupDepositEnabled && policy.signupDepositAmount > 0;
    let deposit = await this.prisma.taskerDeposit.findUnique({ where: { taskerId } });
    if (deposit) deposit = await this.reconcileStripe(deposit);
    if (!deposit && required) {
      deposit = await this.prisma.taskerDeposit.upsert({
        where: { taskerId },
        create: { taskerId, amount: policy.signupDepositAmount.toFixed(2), currency: policy.currency },
        update: {},
      });
    } else if (
      deposit?.status === DEPOSIT_STATUS.Pending &&
      required &&
      (Number(deposit.amount) !== policy.signupDepositAmount || deposit.currency !== policy.currency)
    ) {
      deposit = await this.prisma.taskerDeposit.update({
        where: { taskerId },
        data: { amount: policy.signupDepositAmount.toFixed(2), currency: policy.currency },
      });
    }
    return { required, deposit };
  }

  async taskerView(taskerId: number) {
    const { required, deposit } = await this.forTasker(taskerId);
    const satisfied = !required || (deposit !== null && SATISFIED.has(deposit.status));
    return {
      required,
      satisfied,
      deposit: deposit ? this.view(deposit) : null,
      payWith: required && !satisfied ? (this.stripe.isEnabled() ? ['stripe', 'cmi'] : ['cmi']) : [],
      checkoutEndpoint: required && !satisfied ? (this.stripe.isEnabled() ? '/api/tasker-dashboard/deposit/stripe-checkout' : '/api/payments/cmi/checkout') : null,
    };
  }

  /** Stripe-hosted card page for the deposit. The card is entered on Stripe; nothing card-related touches Latache. */
  async startStripeCheckout(user: User, locale: string): Promise<{ url: string }> {
    const client = this.stripe.client();
    const deposit = await this.requirePayable(user.id);

    // Re-use a still-open session for the same amount instead of stacking up several payable pages.
    if (deposit.providerReference?.startsWith('cs_')) {
      const open = await client.checkout.sessions.retrieve(deposit.providerReference);
      if (open.status === 'open' && open.url && open.amount_total === Math.round(Number(deposit.amount) * 100)) {
        return { url: open.url };
      }
      if (open.status === 'open') await client.checkout.sessions.expire(open.id).catch(() => undefined);
    }

    const base = this.config.get<string>('frontend.baseUrl', 'http://localhost:3000').replace(/\/$/, '');
    const returnPage = `${base}/${locale}/tasker/onboarding/deposit`;
    const metadata = { purpose: 'tasker_deposit', taskerId: String(user.id), depositId: deposit.id };
    const session = await client.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: deposit.currency.toLowerCase(),
            unit_amount: Math.round(Number(deposit.amount) * 100),
            product_data: { name: 'Latache Tasker signup security deposit' },
          },
        },
      ],
      ...(user.email ? { customer_email: user.email } : {}),
      client_reference_id: String(user.id),
      metadata,
      success_url: `${returnPage}?payment=success`,
      cancel_url: `${returnPage}?payment=cancelled`,
    });
    if (!session.url) throw new ConflictException('Stripe did not return a payment page; please try again');
    await this.prisma.taskerDeposit.update({ where: { taskerId: user.id }, data: { providerReference: session.id } });
    return { url: session.url };
  }

  /**
   * Marks a pending deposit paid once its Stripe Checkout session is paid. Asks Stripe directly, so it works
   * without a webhook: it runs whenever the deposit is read (return from checkout, dashboard, admin approval).
   * A Stripe outage must never break those reads.
   */
  private async reconcileStripe(deposit: DepositRow): Promise<DepositRow> {
    if (deposit.status !== DEPOSIT_STATUS.Pending || !deposit.providerReference?.startsWith('cs_') || !this.stripe.isEnabled()) {
      return deposit;
    }
    try {
      const session = await this.stripe.client().checkout.sessions.retrieve(deposit.providerReference);
      if (
        session.payment_status !== 'paid' ||
        session.metadata?.purpose !== 'tasker_deposit' ||
        session.metadata?.depositId !== deposit.id ||
        session.amount_total === null ||
        !session.currency
      ) {
        return deposit;
      }
      const amount = session.amount_total / 100;
      const currency = session.currency.toUpperCase();
      const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
      return await this.prisma.$transaction(async (transaction) => {
        // The money is taken: record exactly what was paid, even if an admin changed the configured amount meanwhile.
        await transaction.taskerDeposit.updateMany({
          where: { id: deposit.id, status: DEPOSIT_STATUS.Pending },
          data: { amount: amount.toFixed(2), currency },
        });
        return this.markPaid(deposit.taskerId, { amount, currency, method: 'stripe', reference: intent ?? session.id }, transaction);
      });
    } catch (error) {
      this.logger.warn(`Stripe deposit check for tasker ${deposit.taskerId} failed: ${error instanceof Error ? error.message : String(error)}`);
      return (await this.prisma.taskerDeposit.findUnique({ where: { taskerId: deposit.taskerId } })) ?? deposit;
    }
  }

  /** Admin approval gate. Null when fine, else a blocking reason key. */
  async approvalBlocker(taskerId: number): Promise<string | null> {
    const { required, deposit } = await this.forTasker(taskerId);
    if (!required) return null;
    return deposit && SATISFIED.has(deposit.status) ? null : 'signupDepositPaid';
  }

  async requirePayable(taskerId: number): Promise<DepositRow> {
    const { required, deposit } = await this.forTasker(taskerId);
    if (!required || !deposit) {
      throw new ConflictException({ code: 'TASKER_DEPOSIT_NOT_REQUIRED', message: 'No signup deposit is required' });
    }
    if (deposit.status !== DEPOSIT_STATUS.Pending) {
      throw new ConflictException({ code: 'TASKER_DEPOSIT_ALREADY_SETTLED', message: `The deposit is already ${deposit.status}` });
    }
    return deposit;
  }

  /** Called by a payment provider callback (inside its transaction). Idempotent per reference. */
  async markPaid(
    taskerId: number,
    input: { amount: number; currency: string; method: string; reference: string },
    transaction: Prisma.TransactionClient,
  ): Promise<DepositRow> {
    // Row lock: two concurrent settlements must not both issue the receipt invoice and notification.
    await transaction.$queryRaw`SELECT 1 FROM "TaskerDeposits" WHERE "taskerId" = ${taskerId} FOR UPDATE`;
    const deposit = await transaction.taskerDeposit.findUnique({ where: { taskerId } });
    if (!deposit) throw new NotFoundException('Deposit not found');
    if (deposit.status === DEPOSIT_STATUS.Paid) return deposit;
    if (Math.abs(Number(deposit.amount) - input.amount) > 0.009 || deposit.currency !== input.currency) {
      throw new BadRequestException('Paid amount does not match the deposit');
    }
    const updated = await transaction.taskerDeposit.update({
      where: { taskerId },
      data: { status: DEPOSIT_STATUS.Paid, paidAt: new Date(), paymentMethod: input.method, providerReference: input.reference },
    });
    await this.invoices.issueDepositInvoice(updated.id, transaction);
    await this.notifications.create(
      taskerId,
      {
        category: 'payments',
        type: 'tasker_deposit_paid',
        title: 'Deposit received',
        body: `Your signup deposit of ${updated.currency} ${Number(updated.amount).toFixed(2)} was received. Your application can now be approved.`,
        entityType: 'tasker_deposit',
        entityId: updated.id,
        audienceRole: UserRole.Tasker,
      },
      transaction,
    );
    return updated;
  }

  async adminList(query: { status?: string; page?: number; limit?: number; search?: string }) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const where: Prisma.TaskerDepositWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            tasker: {
              OR: [
                { email: { contains: search, mode: 'insensitive' } },
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.taskerDeposit.findMany({
        where,
        include: { tasker: { select: { id: true, firstName: true, lastName: true, email: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.taskerDeposit.count({ where }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        ...this.view(row),
        tasker: { id: String(row.tasker.id), name: `${row.tasker.firstName ?? ''} ${row.tasker.lastName ?? ''}`.trim(), email: row.tasker.email },
      })),
    };
  }

  async adminForTasker(taskerId: number) {
    const tasker = await this.prisma.user.findFirst({ where: { id: taskerId, roles: { has: UserRole.Tasker } }, select: { id: true } });
    if (!tasker) throw new NotFoundException('Tasker not found');
    return this.taskerView(taskerId);
  }

  /**
   * mark_paid: received off-platform (bank transfer / cash at office).
   * waive: no deposit for this Tasker. refund: deposit returned off-platform.
   */
  async adminAction(actor: User, taskerId: number, dto: { action: 'mark_paid' | 'waive' | 'refund'; reference?: string; note?: string }) {
    const { deposit } = await this.forTasker(taskerId);
    if (!deposit) {
      throw new ConflictException({ code: 'TASKER_DEPOSIT_NOT_REQUIRED', message: 'Enable the signup deposit in settings first' });
    }
    const now = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      let row: DepositRow;
      if (dto.action === 'mark_paid') {
        if (deposit.status !== DEPOSIT_STATUS.Pending) throw new ConflictException(`Deposit is already ${deposit.status}`);
        row = await this.markPaid(
          taskerId,
          { amount: Number(deposit.amount), currency: deposit.currency, method: 'manual', reference: dto.reference?.trim() || `manual:${actor.id}:${now.getTime()}` },
          transaction,
        );
      } else if (dto.action === 'waive') {
        if (deposit.status !== DEPOSIT_STATUS.Pending) throw new ConflictException(`Deposit is already ${deposit.status}`);
        row = await transaction.taskerDeposit.update({ where: { taskerId }, data: { status: DEPOSIT_STATUS.Waived, waivedAt: now } });
      } else {
        if (deposit.status !== DEPOSIT_STATUS.Paid) throw new ConflictException('Only a paid deposit can be refunded');
        row = await transaction.taskerDeposit.update({ where: { taskerId }, data: { status: DEPOSIT_STATUS.Refunded, refundedAt: now } });
      }
      row = await transaction.taskerDeposit.update({
        where: { taskerId },
        data: { reviewedById: actor.id, adminNote: dto.note?.trim() || null },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: taskerId,
          action: `tasker_deposit_${dto.action}`,
          entityType: 'tasker_deposit',
          entityId: row.id,
          reason: dto.note ?? null,
          metadata: { amount: Number(row.amount), currency: row.currency, reference: dto.reference ?? null },
        },
        transaction,
      );
      return row;
    });
    return this.view(updated);
  }

  view(deposit: DepositRow) {
    return {
      id: deposit.id,
      taskerId: String(deposit.taskerId),
      amount: Number(deposit.amount),
      currency: deposit.currency,
      status: deposit.status,
      paymentMethod: deposit.paymentMethod,
      providerReference: deposit.providerReference,
      paidAt: deposit.paidAt?.toISOString() ?? null,
      waivedAt: deposit.waivedAt?.toISOString() ?? null,
      refundedAt: deposit.refundedAt?.toISOString() ?? null,
      adminNote: deposit.adminNote,
      createdAt: deposit.createdAt.toISOString(),
    };
  }
}
