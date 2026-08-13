import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type {
  PayoutCapabilityView,
  PayoutMethodView,
  PayoutSecurityView,
  WalletSummaryView,
  WalletTransactionView,
  WalletTransactionsListView,
  WithdrawalView,
} from '../tasker-dashboard.contracts';
import {
  PAYOUT_EXECUTION_MODE,
  PAYOUT_METHOD_TYPE,
  WALLET_ENTRY_KIND,
  WITHDRAWAL_STATUS,
} from '../tasker-dashboard.constants';
import type {
  ChangePayoutPinDto,
  ConfigurePayoutPinDto,
  CreatePayoutMethodDto,
  ListWalletTransactionsQueryDto,
  RequestWithdrawalDto,
} from '../dto';
import { monthStart, roundMoney } from '../tasker-dashboard.utils';
import { PayoutDataSecurityService } from './payout-data-security.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { TaskerFinanceService } from '../../tasker-finance/tasker-finance.service';
import type { TaskerEarningsQueryDto } from '../../tasker-finance/dto/tasker-finance.dto';

@Injectable()
export class TaskerWalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly security: PayoutDataSecurityService,
    private readonly notifications: NotificationsService,
    private readonly taskerFinance: TaskerFinanceService,
  ) {}

  async summary(taskerId: number): Promise<WalletSummaryView> {
    const wallet = await this.ensureWallet(taskerId);
    const month = monthStart();
    const [legacyMonthEarnings, monthEarnings, paidWithdrawals, pendingEarnings, platformAccount] =
      await Promise.all([
        this.prisma.taskerWalletLedgerEntry.aggregate({
          where: {
            taskerId,
            kind: WALLET_ENTRY_KIND.Earning,
            status: 'settled',
            createdAt: { gte: month },
          },
          _sum: { amount: true },
        }),
        this.prisma.taskerEarning.aggregate({
          where: { taskerId, settledAt: { gte: month } },
          _sum: { taskerNetAmount: true, reversedAmount: true },
        }),
        this.prisma.taskerWithdrawal.aggregate({
          where: { taskerId, status: WITHDRAWAL_STATUS.Paid },
          _sum: { amount: true },
        }),
        this.prisma.taskerEarning.findMany({
          where: {
            taskerId,
            status: { in: ['pending', 'partially_reversed'] },
          },
          select: { clearsAt: true, holdExtendedUntil: true },
          orderBy: { clearsAt: 'asc' },
        }),
        this.taskerFinance.platformAccount(taskerId),
      ]);
    const expectedDates = pendingEarnings.map((item) =>
      item.holdExtendedUntil && item.holdExtendedUntil > item.clearsAt
        ? item.holdExtendedUntil
        : item.clearsAt,
    );
    return {
      availableBalance: {
        amount: Number(wallet.availableBalance),
        currency: wallet.currency,
      },
      pendingBalance: {
        amount: Number(wallet.pendingBalance),
        currency: wallet.currency,
      },
      totalEarningsThisMonth: {
        amount: roundMoney(
          Number(legacyMonthEarnings._sum.amount ?? 0) +
            Number(monthEarnings._sum.taskerNetAmount ?? 0) -
            Number(monthEarnings._sum.reversedAmount ?? 0),
        ),
        currency: wallet.currency,
      },
      totalWithdrawn: {
        amount: Number(paidWithdrawals._sum.amount ?? 0),
        currency: wallet.currency,
      },
      payoutExecutionMode: this.executionMode(),
      payoutPinConfigured: Boolean(wallet.payoutPinHash),
      pendingEarningsCount: pendingEarnings.length,
      nextExpectedAvailableAt: expectedDates[0]?.toISOString() ?? null,
      outstandingPlatformPayable: platformAccount.outstandingPlatformPayable,
      cashBookingsRestricted: platformAccount.cashBookingsRestricted,
      cashBookingRestrictionReason: platformAccount.restrictionReason,
    };
  }

  listEarnings(taskerId: number, query: TaskerEarningsQueryDto) {
    return this.taskerFinance.listTaskerEarnings(taskerId, query);
  }

  platformPayables(taskerId: number, query: TaskerEarningsQueryDto) {
    return this.taskerFinance.taskerPlatformPayables(taskerId, query);
  }

  async listTransactions(
    taskerId: number,
    query: ListWalletTransactionsQueryDto,
  ): Promise<WalletTransactionsListView> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    if (query.cursor) {
      const cursorOwned = await this.prisma.taskerWalletLedgerEntry.count({
        where: { id: query.cursor, taskerId },
      });
      if (cursorOwned === 0) throw new BadRequestException('Wallet transaction cursor is invalid');
    }
    const [items, totalItems] = await Promise.all([
      this.prisma.taskerWalletLedgerEntry.findMany({
        where: { taskerId },
        include: {
          booking: {
            select: {
              customer: {
                select: { id: true, firstName: true, lastName: true, profilePicture: true },
              },
              service: { select: { id: true, name: true, slug: true, icon: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : { skip: offset }),
        take: query.cursor ? limit + 1 : limit,
      }),
      this.prisma.taskerWalletLedgerEntry.count({ where: { taskerId } }),
    ]);
    const hasMore = query.cursor ? items.length > limit : offset + items.length < totalItems;
    const pageItems = items.slice(0, limit);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      nextCursor: hasMore ? (pageItems.at(-1)?.id ?? null) : null,
      hasMore,
      items: pageItems.map((entry) => this.serializeTransaction(entry)),
    };
  }

  async recentTransactions(taskerId: number, take = 8): Promise<WalletTransactionView[]> {
    const items = await this.prisma.taskerWalletLedgerEntry.findMany({
      where: { taskerId },
      include: {
        booking: {
          select: {
            customer: {
              select: { id: true, firstName: true, lastName: true, profilePicture: true },
            },
            service: { select: { id: true, name: true, slug: true, icon: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return items.map((entry) => this.serializeTransaction(entry));
  }

  payoutCapabilities(): PayoutCapabilityView[] {
    const encryptionReady = this.security.isConfigured();
    const executionMode = this.executionMode();
    const withdrawalReady = executionMode === PAYOUT_EXECUTION_MODE.Manual;
    return [
      PAYOUT_METHOD_TYPE.BankTransfer,
      PAYOUT_METHOD_TYPE.OrangeMoney,
      PAYOUT_METHOD_TYPE.Paypal,
      PAYOUT_METHOD_TYPE.GooglePay,
    ].map((type) => {
      if (type === PAYOUT_METHOD_TYPE.GooglePay) {
        return {
          type,
          setupSupported: false,
          withdrawalSupported: false,
          executionMode,
          reason:
            'Google Pay is a checkout wallet, not a supported payout destination in this backend.',
        };
      }
      return {
        type,
        setupSupported: encryptionReady,
        withdrawalSupported: encryptionReady && withdrawalReady,
        executionMode,
        reason: !encryptionReady
          ? 'Configure PAYOUT_DATA_ENCRYPTION_KEY before storing payout account details.'
          : !withdrawalReady
            ? 'Payout execution is disabled. Set TASKER_PAYOUT_EXECUTION_MODE=manual only if operations will process queued transfers.'
            : null,
      };
    });
  }

  async payoutSecurity(taskerId: number): Promise<PayoutSecurityView> {
    const wallet = await this.ensureWallet(taskerId);
    return {
      pinConfigured: Boolean(wallet.payoutPinHash),
      lockedUntil:
        wallet.payoutPinLockedUntil && wallet.payoutPinLockedUntil > new Date()
          ? wallet.payoutPinLockedUntil.toISOString()
          : null,
    };
  }

  async configurePayoutPin(
    taskerId: number,
    dto: ConfigurePayoutPinDto,
  ): Promise<PayoutSecurityView> {
    const user = await this.prisma.user.findUnique({
      where: { id: taskerId },
      select: { password: true },
    });
    if (!user?.password) {
      throw new ConflictException(
        'A local account password is required before configuring a payout PIN',
      );
    }
    if (!(await compare(dto.password, user.password))) {
      throw new BadRequestException('Current account password is incorrect');
    }
    const wallet = await this.ensureWallet(taskerId);
    if (wallet.payoutPinHash) {
      throw new ConflictException('Payout PIN is already configured; use the change-PIN endpoint');
    }
    const rounds = this.config.get<number>('auth.bcryptRounds', 12);
    const payoutPinHash = await hash(dto.pin, rounds);
    await this.prisma.taskerWallet.update({
      where: { taskerId },
      data: {
        payoutPinHash,
        payoutPinFailedAttempts: 0,
        payoutPinLockedUntil: null,
        payoutPinUpdatedAt: new Date(),
      },
    });
    return this.payoutSecurity(taskerId);
  }

  async changePayoutPin(taskerId: number, dto: ChangePayoutPinDto): Promise<PayoutSecurityView> {
    if (dto.currentPin === dto.newPin) {
      throw new BadRequestException('New payout PIN must be different from the current PIN');
    }
    await this.assertPayoutPin(taskerId, dto.currentPin);
    const rounds = this.config.get<number>('auth.bcryptRounds', 12);
    const payoutPinHash = await hash(dto.newPin, rounds);
    await this.prisma.taskerWallet.update({
      where: { taskerId },
      data: {
        payoutPinHash,
        payoutPinFailedAttempts: 0,
        payoutPinLockedUntil: null,
        payoutPinUpdatedAt: new Date(),
      },
    });
    return this.payoutSecurity(taskerId);
  }

  async listPayoutMethods(taskerId: number): Promise<PayoutMethodView[]> {
    const rows = await this.prisma.taskerPayoutMethod.findMany({
      where: { taskerId, deletedAt: null, status: 'active' },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.serializePayoutMethod(row));
  }

  async createPayoutMethod(
    taskerId: number,
    dto: CreatePayoutMethodDto,
  ): Promise<PayoutMethodView> {
    if (dto.type === PAYOUT_METHOD_TYPE.GooglePay) {
      throw new BadRequestException(
        'Google Pay cannot be configured as a payout destination. Use a bank, Orange Money, or PayPal payout account.',
      );
    }
    const { payload, maskedIdentifier } = this.payoutPayload(dto);
    const encryptedPayload = this.security.encrypt(payload);

    const created = await this.prisma.$transaction(async (transaction) => {
      const activeCount = await transaction.taskerPayoutMethod.count({
        where: { taskerId, deletedAt: null, status: 'active' },
      });
      const makeDefault = dto.isDefault === true || activeCount === 0;
      if (makeDefault) {
        await transaction.taskerPayoutMethod.updateMany({
          where: { taskerId, deletedAt: null },
          data: { isDefault: false },
        });
      }
      return transaction.taskerPayoutMethod.create({
        data: {
          taskerId,
          type: dto.type,
          label: dto.label,
          maskedIdentifier,
          encryptedPayload,
          isDefault: makeDefault,
        },
      });
    });
    return this.serializePayoutMethod(created);
  }

  async setDefaultPayoutMethod(taskerId: number, id: string): Promise<PayoutMethodView> {
    const method = await this.requirePayoutMethod(taskerId, id);
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.taskerPayoutMethod.updateMany({
        where: { taskerId, deletedAt: null },
        data: { isDefault: false },
      });
      return transaction.taskerPayoutMethod.update({
        where: { id: method.id },
        data: { isDefault: true },
      });
    });
    return this.serializePayoutMethod(updated);
  }

  async deletePayoutMethod(taskerId: number, id: string): Promise<{ deleted: true; id: string }> {
    const method = await this.requirePayoutMethod(taskerId, id);
    const withdrawals = await this.prisma.taskerWithdrawal.count({
      where: { taskerId, payoutMethodId: id },
    });
    if (withdrawals > 0) {
      throw new ConflictException({
        code: 'PAYOUT_METHOD_PURGE_BLOCKED',
        message:
          'This payout method is referenced by withdrawal history and cannot be permanently deleted.',
        withdrawalCount: withdrawals,
      });
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.taskerPayoutMethod.delete({ where: { id } });
      if (method.isDefault) {
        const replacement = await transaction.taskerPayoutMethod.findFirst({
          where: { taskerId, id: { not: id }, deletedAt: null, status: 'active' },
          orderBy: { createdAt: 'asc' },
        });
        if (replacement) {
          await transaction.taskerPayoutMethod.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }
    });
    return { deleted: true, id };
  }

  async requestWithdrawal(
    taskerId: number,
    dto: RequestWithdrawalDto,
    idempotencyKey: string,
  ): Promise<WithdrawalView> {
    if (this.executionMode() !== PAYOUT_EXECUTION_MODE.Manual) {
      throw new ServiceUnavailableException({
        code: 'PAYOUT_EXECUTION_NOT_CONFIGURED',
        message:
          'Withdrawals are disabled until a real payout process is configured. No funds were reserved.',
      });
    }
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key must contain 8-120 letters, numbers, dot, underscore, colon, or hyphen characters',
      );
    }
    await this.assertPayoutPin(taskerId, dto.pin);
    const method = await this.requirePayoutMethod(taskerId, dto.payoutMethodId);
    if (method.type === PAYOUT_METHOD_TYPE.GooglePay) {
      throw new BadRequestException('Google Pay is not a payout destination');
    }
    const minimum = this.config.get<number>('taskerPayout.minimumWithdrawalAmount', 1);
    const amount = roundMoney(dto.amount);
    if (amount < minimum) {
      throw new BadRequestException(`Minimum withdrawal amount is ${minimum}`);
    }

    const withdrawal = await this.prisma.$transaction(async (transaction) => {
      await this.ensureWallet(taskerId, transaction);
      // Serialize withdrawal requests per wallet before the idempotency lookup. This
      // makes concurrent retries with the same key observe the first committed row
      // instead of racing into the unique constraint.
      await transaction.$queryRaw`
        SELECT "taskerId" FROM "TaskerWallets" WHERE "taskerId" = ${taskerId} FOR UPDATE
      `;

      const existing = await transaction.taskerWithdrawal.findFirst({
        where: { taskerId, idempotencyKey },
        include: { payoutMethod: true },
      });
      if (existing) {
        if (existing.payoutMethodId !== dto.payoutMethodId || Number(existing.amount) !== amount) {
          throw new ConflictException(
            'Idempotency-Key was already used with different withdrawal parameters',
          );
        }
        return existing;
      }

      const activeMethod = await transaction.taskerPayoutMethod.findFirst({
        where: {
          id: method.id,
          taskerId,
          deletedAt: null,
          status: 'active',
        },
      });
      if (!activeMethod) {
        throw new ConflictException('Payout method is no longer active');
      }

      const wallet = await transaction.taskerWallet.findUniqueOrThrow({
        where: { taskerId },
      });
      if (Number(wallet.availableBalance) < amount) {
        throw new BadRequestException('Insufficient available wallet balance');
      }

      const created = await transaction.taskerWithdrawal.create({
        data: {
          taskerId,
          payoutMethodId: method.id,
          amount: amount.toFixed(2),
          currency: wallet.currency,
          status: WITHDRAWAL_STATUS.PendingReview,
          idempotencyKey,
        },
        include: { payoutMethod: true },
      });
      await transaction.taskerWallet.update({
        where: { taskerId },
        data: {
          availableBalance: { decrement: amount.toFixed(2) },
          pendingBalance: { increment: amount.toFixed(2) },
        },
      });
      await transaction.taskerWalletLedgerEntry.create({
        data: {
          taskerId,
          withdrawalId: created.id,
          kind: WALLET_ENTRY_KIND.WithdrawalHold,
          status: 'reserved',
          amount: amount.toFixed(2),
          availableDelta: (-amount).toFixed(2),
          pendingDelta: amount.toFixed(2),
          currency: wallet.currency,
          description: `Withdrawal reserved for ${activeMethod.label}`,
          idempotencyKey: `withdrawal:${created.id}:hold`,
        },
      });
      await this.notifications.create(
        taskerId,
        {
          category: 'wallet',
          type: 'withdrawal_requested',
          title: 'Withdrawal requested',
          body: `Your ${wallet.currency} ${amount.toFixed(2)} withdrawal is pending review.`,
          entityType: 'withdrawal',
          entityId: created.id,
        },
        transaction,
      );
      return created;
    });
    return this.serializeWithdrawal(withdrawal);
  }

  async listWithdrawals(taskerId: number): Promise<WithdrawalView[]> {
    const rows = await this.prisma.taskerWithdrawal.findMany({
      where: { taskerId },
      include: { payoutMethod: true },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => this.serializeWithdrawal(row));
  }

  async getWithdrawal(taskerId: number, id: string): Promise<WithdrawalView> {
    const row = await this.prisma.taskerWithdrawal.findFirst({
      where: { id, taskerId },
      include: { payoutMethod: true },
    });
    if (!row) throw new NotFoundException('Withdrawal not found');
    return this.serializeWithdrawal(row);
  }

  async cancelWithdrawal(taskerId: number, id: string): Promise<WithdrawalView> {
    const withdrawal = await this.prisma.$transaction(async (transaction) => {
      const locked = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "TaskerWithdrawals"
        WHERE "id" = ${id} AND "taskerId" = ${taskerId}
        FOR UPDATE
      `;
      if (locked.length === 0) throw new NotFoundException('Withdrawal not found');
      const current = await transaction.taskerWithdrawal.findFirstOrThrow({
        where: { id, taskerId },
        include: { payoutMethod: true },
      });
      if (current.status !== WITHDRAWAL_STATUS.PendingReview) {
        throw new ConflictException('Only pending-review withdrawals can be cancelled');
      }
      await transaction.$queryRaw`
        SELECT "taskerId" FROM "TaskerWallets" WHERE "taskerId" = ${taskerId} FOR UPDATE
      `;
      const amount = Number(current.amount);
      await transaction.taskerWallet.update({
        where: { taskerId },
        data: {
          availableBalance: { increment: amount.toFixed(2) },
          pendingBalance: { decrement: amount.toFixed(2) },
        },
      });
      const updated = await transaction.taskerWithdrawal.update({
        where: { id },
        data: { status: WITHDRAWAL_STATUS.Cancelled, cancelledAt: new Date() },
        include: { payoutMethod: true },
      });
      await transaction.taskerWalletLedgerEntry.create({
        data: {
          taskerId,
          withdrawalId: id,
          kind: WALLET_ENTRY_KIND.WithdrawalRelease,
          status: 'settled',
          amount: amount.toFixed(2),
          availableDelta: amount.toFixed(2),
          pendingDelta: (-amount).toFixed(2),
          currency: current.currency,
          description: 'Withdrawal reservation released after cancellation',
          idempotencyKey: `withdrawal:${id}:cancel-release`,
        },
      });
      await this.notifications.create(
        taskerId,
        {
          category: 'wallet',
          type: 'withdrawal_cancelled',
          title: 'Withdrawal cancelled',
          body: `The reserved ${current.currency} ${amount.toFixed(2)} has been returned to your available balance.`,
          entityType: 'withdrawal',
          entityId: id,
        },
        transaction,
      );
      return updated;
    });
    return this.serializeWithdrawal(withdrawal);
  }

  /**
   * Internal settlement hook for the future customer-payment module.
   * It is intentionally not exposed as an HTTP endpoint to taskers.
   */
  async creditBookingSettlement(input: {
    taskerId: number;
    bookingId: number;
    amount: number;
    currency: string;
    externalReference: string;
    idempotencyKey: string;
  }): Promise<WalletTransactionView> {
    const entry = await this.prisma.$transaction(async (transaction) => {
      const currency = input.currency.toUpperCase();
      const amount = roundMoney(input.amount);
      if (amount <= 0) {
        throw new BadRequestException('Settlement amount must be positive');
      }
      if (!input.externalReference.trim()) {
        throw new BadRequestException('Settlement external reference is required');
      }
      if (!input.idempotencyKey.trim()) {
        throw new BadRequestException('Settlement idempotency key is required');
      }

      const booking = await transaction.booking.findFirst({
        where: {
          id: input.bookingId,
          taskerId: input.taskerId,
          status: 'completed',
        },
      });
      if (!booking) {
        throw new ConflictException('Only a completed task can be settled to a tasker wallet');
      }
      const expectedNet = roundMoney(
        Number(booking.serviceAmount ?? 0) -
          (booking.taxInclusive ? Number(booking.taxAmount) : 0) +
          Number(booking.tipAmount),
      );
      if (currency !== booking.paymentCurrency || amount !== expectedNet) {
        throw new ConflictException(
          'Settlement amount/currency does not match the immutable booking pricing snapshot',
        );
      }
      await this.taskerFinance.createPendingEarning({
        booking,
        grossCustomerAmount: Number(booking.totalChargedAmount ?? 0),
        providerSettlementReference: input.externalReference,
        settledAt: booking.paidAt ?? new Date(),
        transaction,
      });
      return transaction.taskerWalletLedgerEntry.findUniqueOrThrow({
        where: { idempotencyKey: `booking:${input.bookingId}:pending-earning` },
      });
    });
    return this.serializeTransaction(entry);
  }

  private async assertPayoutPin(taskerId: number, pin: string): Promise<void> {
    await this.ensureWallet(taskerId);
    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "taskerId" FROM "TaskerWallets" WHERE "taskerId" = ${taskerId} FOR UPDATE
      `;
      const wallet = await transaction.taskerWallet.findUniqueOrThrow({
        where: { taskerId },
      });
      if (!wallet.payoutPinHash) {
        return { state: 'not_configured' as const, lockedUntil: null as Date | null };
      }
      const now = new Date();
      if (wallet.payoutPinLockedUntil && wallet.payoutPinLockedUntil > now) {
        return {
          state: 'locked' as const,
          lockedUntil: wallet.payoutPinLockedUntil,
        };
      }
      const valid = await compare(pin, wallet.payoutPinHash);
      if (valid) {
        if (wallet.payoutPinFailedAttempts !== 0 || wallet.payoutPinLockedUntil) {
          await transaction.taskerWallet.update({
            where: { taskerId },
            data: { payoutPinFailedAttempts: 0, payoutPinLockedUntil: null },
          });
        }
        return { state: 'valid' as const, lockedUntil: null as Date | null };
      }

      const attempts = wallet.payoutPinFailedAttempts + 1;
      const lockNow = attempts >= 5;
      const lockedUntil = lockNow ? new Date(now.getTime() + 15 * 60 * 1000) : null;
      await transaction.taskerWallet.update({
        where: { taskerId },
        data: {
          payoutPinFailedAttempts: lockNow ? 0 : attempts,
          payoutPinLockedUntil: lockedUntil,
        },
      });
      return {
        state: lockNow ? ('locked' as const) : ('invalid' as const),
        lockedUntil,
      };
    });

    if (result.state === 'valid') return;
    if (result.state === 'not_configured') {
      throw new ConflictException('Configure a payout PIN before requesting a withdrawal');
    }
    if (result.state === 'locked') {
      throw new HttpException(
        {
          code: 'PAYOUT_PIN_LOCKED',
          message: 'Payout PIN is temporarily locked after repeated failed attempts',
          lockedUntil: result.lockedUntil?.toISOString() ?? null,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    throw new BadRequestException('Payout PIN is incorrect');
  }

  private executionMode(): string {
    return this.config.get<string>('taskerPayout.executionMode', PAYOUT_EXECUTION_MODE.Disabled);
  }

  private async ensureWallet(
    taskerId: number,
    transaction?: Prisma.TransactionClient,
    requestedCurrency?: string,
  ) {
    const database = transaction ?? this.prisma;
    const currency = (
      requestedCurrency ?? this.config.get<string>('taskerPayout.currency', 'USD')
    ).toUpperCase();
    return database.taskerWallet.upsert({
      where: { taskerId },
      create: { taskerId, currency },
      update: {},
    });
  }

  private async requirePayoutMethod(taskerId: number, id: string) {
    const method = await this.prisma.taskerPayoutMethod.findFirst({
      where: { id, taskerId, deletedAt: null, status: 'active' },
    });
    if (!method) throw new NotFoundException('Payout method not found');
    return method;
  }

  private payoutPayload(dto: CreatePayoutMethodDto): {
    payload: Record<string, string>;
    maskedIdentifier: string;
  } {
    if (dto.type === PAYOUT_METHOD_TYPE.BankTransfer) {
      const iban = dto.iban as string;
      return {
        payload: {
          accountHolderName: dto.accountHolderName as string,
          bankName: dto.bankName as string,
          iban,
        },
        maskedIdentifier: `IBAN •••• ${iban.slice(-4)}`,
      };
    }
    if (dto.type === PAYOUT_METHOD_TYPE.OrangeMoney) {
      return {
        payload: {
          accountHolderName: dto.accountHolderName as string,
          phoneCountryCode: dto.phoneCountryCode as string,
          phoneNumber: dto.phoneNumber as string,
        },
        maskedIdentifier: `${dto.phoneCountryCode} •••• ${(dto.phoneNumber as string).slice(-4)}`,
      };
    }
    if (dto.type === PAYOUT_METHOD_TYPE.Paypal) {
      const email = dto.paypalEmail as string;
      const [local, domain] = email.split('@');
      const maskedLocal = `${local?.[0] ?? '*'}***`;
      return {
        payload: {
          accountHolderName: dto.accountHolderName as string,
          email,
        },
        maskedIdentifier: `${maskedLocal}@${domain ?? ''}`,
      };
    }
    throw new BadRequestException('Unsupported payout method');
  }

  private serializePayoutMethod(method: {
    id: string;
    type: string;
    label: string;
    maskedIdentifier: string;
    isDefault: boolean;
    status: string;
    createdAt: Date;
  }): PayoutMethodView {
    return {
      id: method.id,
      type: method.type,
      label: method.label,
      maskedIdentifier: method.maskedIdentifier,
      isDefault: method.isDefault,
      status: method.status,
      createdAt: method.createdAt.toISOString(),
    };
  }

  private serializeTransaction(entry: {
    id: string;
    kind: string;
    status: string;
    amount: Prisma.Decimal;
    availableDelta: Prisma.Decimal;
    pendingDelta: Prisma.Decimal;
    currency: string;
    description: string;
    bookingId: number | null;
    withdrawalId: string | null;
    earningId?: string | null;
    createdAt: Date;
    booking?: {
      customer: {
        id: number;
        firstName: string | null;
        lastName: string | null;
        profilePicture: string | null;
      };
      service: {
        id: number;
        name: string | null;
        slug: string | null;
        icon: string | null;
      };
    } | null;
  }): WalletTransactionView {
    return {
      id: entry.id,
      kind: entry.kind,
      status: entry.status,
      amount: { amount: Number(entry.amount), currency: entry.currency },
      availableDelta: Number(entry.availableDelta),
      pendingDelta: Number(entry.pendingDelta),
      description: entry.description,
      bookingId: entry.bookingId === null ? null : String(entry.bookingId),
      withdrawalId: entry.withdrawalId,
      earningId: entry.earningId ?? null,
      booking: entry.booking
        ? {
            customer: {
              id: String(entry.booking.customer.id),
              name: `${entry.booking.customer.firstName ?? ''} ${entry.booking.customer.lastName ?? ''}`.trim(),
              avatar: entry.booking.customer.profilePicture ?? '',
            },
            service: {
              id: String(entry.booking.service.id),
              slug: entry.booking.service.slug ?? '',
              name: entry.booking.service.name ?? '',
              icon: entry.booking.service.icon ?? '',
            },
          }
        : null,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private serializeWithdrawal(withdrawal: {
    id: string;
    amount: Prisma.Decimal;
    currency: string;
    status: string;
    providerReference: string | null;
    failureReason: string | null;
    requestedAt: Date;
    processedAt: Date | null;
    cancelledAt: Date | null;
    payoutMethod: {
      id: string;
      type: string;
      label: string;
      maskedIdentifier: string;
      isDefault: boolean;
      status: string;
      createdAt: Date;
    };
  }): WithdrawalView {
    return {
      id: withdrawal.id,
      amount: { amount: Number(withdrawal.amount), currency: withdrawal.currency },
      status: withdrawal.status,
      payoutMethod: this.serializePayoutMethod(withdrawal.payoutMethod),
      providerReference: withdrawal.providerReference,
      failureReason: withdrawal.failureReason,
      requestedAt: withdrawal.requestedAt.toISOString(),
      processedAt: withdrawal.processedAt?.toISOString() ?? null,
      cancelledAt: withdrawal.cancelledAt?.toISOString() ?? null,
    };
  }
}
