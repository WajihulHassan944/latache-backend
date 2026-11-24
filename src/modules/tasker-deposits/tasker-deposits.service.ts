import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: PlatformSettingsService,
    private readonly invoices: InvoicesService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * The Tasker's deposit, created on first read while the policy requires one.
   * A still-pending deposit follows the current configured amount.
   */
  async forTasker(taskerId: number) {
    const policy = await this.settings.taskerFinancePolicy();
    const required = policy.signupDepositEnabled && policy.signupDepositAmount > 0;
    let deposit = await this.prisma.taskerDeposit.findUnique({ where: { taskerId } });
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
      payWith: required && !satisfied ? ['cmi'] : [],
      checkoutEndpoint: required && !satisfied ? '/api/payments/cmi/checkout' : null,
    };
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
