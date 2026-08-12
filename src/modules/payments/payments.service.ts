import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { WALLET_ENTRY_KIND } from '../tasker-dashboard/tasker-dashboard.constants';
import { TaskerFinanceService } from '../tasker-finance/tasker-finance.service';
import type { ConfirmCashCollectionInput } from '../tasker-finance/tasker-finance.types';
import {
  CUSTOMER_WALLET_ENTRY_KIND,
  PAYMENT_SOURCE,
  PAYMENT_STATUS,
  PAYMENT_TRANSACTION_KIND,
} from './payments.constants';
import { ListPaymentTransactionsQueryDto, RetryBookingPaymentDto } from './payments.dto';
import type {
  BookingPaymentStatusView,
  BookingRefundRequest,
  BookingRefundResult,
  PaymentOrchestrationResult,
  PaymentTransactionListView,
  PaymentTransactionView,
  SavedPaymentMethodView,
  SetupIntentView,
  WalletTopupIntentView,
  WalletView,
} from './payments.types';
import { StripeService } from './stripe.service';

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const moneyString = (value: number): string => roundMoney(value).toFixed(2);
const toMinorUnits = (value: number): number => Math.round(roundMoney(value) * 100);

@Injectable()
export class PaymentsService {
  private readonly currency: string;
  private readonly minimumBillableMinutes: number;
  private readonly minimumWalletTopup: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeProvider: StripeService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly taskerFinance: TaskerFinanceService,
  ) {
    this.currency = config.get<string>('payments.currency', 'USD').toUpperCase();
    this.minimumBillableMinutes = config.get<number>('payments.minimumBillableMinutes', 120);
    this.minimumWalletTopup = config.get<number>('payments.minimumWalletTopup', 5);
  }

  isStripeEnabled(): boolean {
    return this.stripeProvider.isEnabled();
  }

  async createSetupIntent(customerId: number): Promise<SetupIntentView> {
    const stripeCustomerId = await this.ensureStripeCustomer(customerId);
    const intent = await this.stripeProvider.client().setupIntents.create(
      {
        customer: stripeCustomerId,
        usage: 'off_session',
        payment_method_types: ['card'],
        metadata: {
          latacheCustomerId: String(customerId),
          purpose: 'future_booking_payment',
        },
      },
      { idempotencyKey: `latache:setup:${customerId}:${Date.now()}` },
    );
    if (!intent.client_secret) {
      throw new ServiceUnavailableException('Stripe did not return a SetupIntent client secret');
    }
    return {
      id: intent.id,
      clientSecret: intent.client_secret,
      customerId: stripeCustomerId,
    };
  }

  async listPaymentMethods(customerId: number): Promise<SavedPaymentMethodView[]> {
    const stripeCustomerId = await this.ensureStripeCustomer(customerId);
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: customerId },
      select: { defaultStripePaymentMethodId: true },
    });
    const methods = await this.stripeProvider.client().paymentMethods.list({
      customer: stripeCustomerId,
      type: 'card',
      limit: 100,
    });
    return methods.data.map((method) => ({
      id: method.id,
      type: method.type,
      brand: method.card?.brand ?? null,
      last4: method.card?.last4 ?? null,
      expMonth: method.card?.exp_month ?? null,
      expYear: method.card?.exp_year ?? null,
      isDefault: user.defaultStripePaymentMethodId === method.id,
    }));
  }

  async setDefaultPaymentMethod(
    customerId: number,
    paymentMethodId: string,
  ): Promise<SavedPaymentMethodView> {
    const stripeCustomerId = await this.ensureStripeCustomer(customerId);
    const method = await this.assertStripePaymentMethodOwnership(stripeCustomerId, paymentMethodId);
    await this.stripeProvider.client().customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    await this.prisma.user.update({
      where: { id: customerId },
      data: { defaultStripePaymentMethodId: paymentMethodId },
    });
    return {
      id: method.id,
      type: method.type,
      brand: method.card?.brand ?? null,
      last4: method.card?.last4 ?? null,
      expMonth: method.card?.exp_month ?? null,
      expYear: method.card?.exp_year ?? null,
      isDefault: true,
    };
  }

  async detachPaymentMethod(
    customerId: number,
    paymentMethodId: string,
  ): Promise<{ deleted: true; id: string }> {
    const stripeCustomerId = await this.ensureStripeCustomer(customerId);
    await this.assertStripePaymentMethodOwnership(stripeCustomerId, paymentMethodId);

    const inUse = await this.prisma.booking.count({
      where: {
        customerId,
        stripePaymentMethodId: paymentMethodId,
        paymentStatus: {
          in: [PAYMENT_STATUS.Ready, PAYMENT_STATUS.Processing, PAYMENT_STATUS.RequiresAction],
        },
        status: { notIn: ['completed', 'cancelled'] },
      },
    });
    if (inUse > 0) {
      throw new ConflictException(
        'This payment method is attached to an active booking and cannot be removed',
      );
    }

    await this.stripeProvider.client().paymentMethods.detach(paymentMethodId);
    await this.prisma.user.updateMany({
      where: { id: customerId, defaultStripePaymentMethodId: paymentMethodId },
      data: { defaultStripePaymentMethodId: null },
    });
    return { deleted: true, id: paymentMethodId };
  }

  async assertPaymentMethodOwnedByCustomer(
    customerId: number,
    paymentMethodId: string,
  ): Promise<void> {
    const stripeCustomerId = await this.ensureStripeCustomer(customerId);
    await this.assertStripePaymentMethodOwnership(stripeCustomerId, paymentMethodId);
  }

  async defaultPaymentMethod(customerId: number): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: { defaultStripePaymentMethodId: true },
    });
    return user?.defaultStripePaymentMethodId ?? null;
  }

  async wallet(customerId: number): Promise<WalletView> {
    const wallet = await this.ensureCustomerWallet(customerId);
    const [refunds, spent] = await Promise.all([
      this.prisma.paymentTransaction.aggregate({
        where: {
          customerId,
          kind: PAYMENT_TRANSACTION_KIND.Refund,
          status: 'succeeded',
        },
        _sum: { amount: true },
      }),
      this.prisma.paymentTransaction.aggregate({
        where: {
          customerId,
          kind: PAYMENT_TRANSACTION_KIND.BookingCharge,
          status: 'succeeded',
        },
        _sum: { amount: true },
      }),
    ]);
    return {
      availableBalance: { amount: Number(wallet.availableBalance), currency: wallet.currency },
      refunds: { amount: Number(refunds._sum.amount ?? 0), currency: wallet.currency },
      totalSpent: { amount: Number(spent._sum.amount ?? 0), currency: wallet.currency },
    };
  }

  async walletLedger(customerId: number, page = 1, limit = 30) {
    const normalizedPage = Math.max(1, page);
    const normalizedLimit = Math.min(100, Math.max(1, limit));
    const skip = (normalizedPage - 1) * normalizedLimit;
    const [rows, totalItems] = await Promise.all([
      this.prisma.customerWalletLedgerEntry.findMany({
        where: { customerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: normalizedLimit,
      }),
      this.prisma.customerWalletLedgerEntry.count({ where: { customerId } }),
    ]);
    return {
      page: normalizedPage,
      limit: normalizedLimit,
      totalItems,
      totalPages: Math.ceil(totalItems / normalizedLimit),
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        amount: { amount: Number(row.amount), currency: row.currency },
        balanceDelta: Number(row.balanceDelta),
        bookingId: row.bookingId ? String(row.bookingId) : null,
        description: row.description,
        providerReference: row.providerReference,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async createWalletTopup(
    customerId: number,
    amountInput: number,
    idempotencyKey: string,
  ): Promise<WalletTopupIntentView> {
    const amount = roundMoney(amountInput);
    if (!idempotencyKey.trim()) {
      throw new BadRequestException('Idempotency-Key header is required');
    }
    if (amount < this.minimumWalletTopup) {
      throw new BadRequestException(
        `Wallet top-up amount must be at least ${this.currency} ${this.minimumWalletTopup.toFixed(2)}`,
      );
    }

    const scopedKey = `wallet-topup:${customerId}:${idempotencyKey.trim()}`;
    const existing = await this.prisma.paymentTransaction.findUnique({
      where: { idempotencyKey: scopedKey },
    });
    if (existing) {
      if (
        Number(existing.amount) !== amount ||
        existing.kind !== PAYMENT_TRANSACTION_KIND.WalletTopup
      ) {
        throw new ConflictException(
          'Idempotency-Key was already used with different top-up parameters',
        );
      }
      if (!existing.providerReference) {
        throw new ConflictException('Existing top-up is missing its Stripe reference');
      }
      const intent = await this.stripeProvider
        .client()
        .paymentIntents.retrieve(existing.providerReference);
      if (!intent.client_secret) {
        throw new ServiceUnavailableException('Stripe top-up client secret is unavailable');
      }
      return {
        transactionId: existing.id,
        paymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        amount: { amount, currency: this.currency },
        status: intent.status,
      };
    }

    const stripeCustomerId = await this.ensureStripeCustomer(customerId);
    const intent = await this.stripeProvider.client().paymentIntents.create(
      {
        amount: toMinorUnits(amount),
        currency: this.currency.toLowerCase(),
        customer: stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        metadata: {
          kind: PAYMENT_TRANSACTION_KIND.WalletTopup,
          latacheCustomerId: String(customerId),
          idempotencyKey: scopedKey,
        },
      },
      { idempotencyKey: scopedKey },
    );
    if (!intent.client_secret) {
      throw new ServiceUnavailableException('Stripe top-up client secret is unavailable');
    }

    const transaction = await this.prisma.paymentTransaction.create({
      data: {
        customerId,
        kind: PAYMENT_TRANSACTION_KIND.WalletTopup,
        provider: 'stripe',
        providerReference: intent.id,
        status: intent.status,
        amount: moneyString(amount),
        currency: this.currency,
        idempotencyKey: scopedKey,
        metadata: {
          stripeCustomerId,
        },
      },
    });

    return {
      transactionId: transaction.id,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      amount: { amount, currency: this.currency },
      status: intent.status,
    };
  }

  async listTransactions(
    customerId: number,
    query: ListPaymentTransactionsQueryDto,
  ): Promise<PaymentTransactionListView> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.PaymentTransactionWhereInput = {
      customerId,
      ...(query.kind && query.kind !== 'all' ? { kind: query.kind } : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.paymentTransaction.count({ where }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => this.serializeTransaction(row)),
    };
  }

  async bookingStatus(customerId: number, bookingId: number): Promise<BookingPaymentStatusView> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return this.serializeBookingPayment(booking);
  }

  async finalizeCompletedBooking(bookingId: number): Promise<PaymentOrchestrationResult> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        workSession: true,
        complaints: {
          where: { status: { in: ['open', 'under_investigation', 'escalated'] } },
          take: 1,
        },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'completed') {
      throw new ConflictException('Only a completed booking can be charged');
    }
    if (
      [PAYMENT_STATUS.Paid, PAYMENT_STATUS.CashConfirmed].includes(booking.paymentStatus as never)
    ) {
      return { bookingId, status: booking.paymentStatus };
    }
    if (booking.complaints.length > 0) {
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { paymentStatus: PAYMENT_STATUS.OnHoldDispute },
      });
      return { bookingId, status: PAYMENT_STATUS.OnHoldDispute };
    }
    if (!booking.workSession?.stoppedAt) {
      throw new ConflictException('A stopped task timer is required before final billing');
    }

    const elapsedSeconds = Math.max(
      0,
      Math.floor(
        (booking.workSession.stoppedAt.getTime() - booking.workSession.startedAt.getTime()) / 1000,
      ) - booking.workSession.accumulatedPausedSecs,
    );
    const actualMinutes = Math.max(1, Math.ceil(elapsedSeconds / 60));
    const authorizedMinutes = booking.estimatedDurationMinutes + booking.extensionMinutes;
    if (actualMinutes > authorizedMinutes) {
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: PAYMENT_STATUS.ReviewRequiredDurationExceeded,
          paymentFailureReason:
            `Actual task duration (${actualMinutes} minutes) exceeds the customer-authorized ` +
            `duration (${authorizedMinutes} minutes).`,
        },
      });
      await this.notifications.create(booking.customerId, {
        category: 'payments',
        type: 'duration_approval_required',
        title: 'Additional task time needs approval',
        body: 'Review the extra task time before Latache attempts the final payment.',
        entityType: 'booking',
        entityId: String(bookingId),
      });
      return {
        bookingId,
        status: PAYMENT_STATUS.ReviewRequiredDurationExceeded,
      };
    }

    const billableMinutes = Math.max(this.minimumBillableMinutes, actualMinutes);
    const rawServiceAmount = roundMoney(Number(booking.hourlyRate) * (billableMinutes / 60));
    const pricingCharges = await this.platformSettings.calculatePricingCharges({
      serviceAmount: rawServiceAmount,
      taskerId: booking.taskerId,
      serviceId: booking.serviceId,
      bookingDate: booking.bookingDate,
      bookingCreatedAt: booking.createdAt,
    });
    const serviceAmount = pricingCharges.serviceAmount;
    const platformFeeAmount = pricingCharges.platformFeeAmount;
    const taxAmount = pricingCharges.taxAmount;
    const serviceSurchargeAmount = pricingCharges.serviceSurchargeAmount;
    const tipAmount = Number(booking.tipAmount);
    const donationAmount = Number(booking.donationAmount);
    const totalAmount = roundMoney(
      serviceAmount +
        platformFeeAmount +
        serviceSurchargeAmount +
        tipAmount +
        donationAmount +
        (pricingCharges.taxInclusive ? 0 : taxAmount),
    );

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        serviceAmount: moneyString(serviceAmount),
        platformFeeAmount: moneyString(platformFeeAmount),
        commissionRatePercent: pricingCharges.commissionRatePercent.toFixed(4),
        taxAmount: moneyString(taxAmount),
        taxRatePercent: pricingCharges.taxRatePercent.toFixed(4),
        taxInclusive: pricingCharges.taxInclusive,
        serviceSurchargeAmount: moneyString(serviceSurchargeAmount),
        paymentCurrency: this.currency,
        paymentFailureReason: null,
      },
    });

    if (booking.paymentSource === PAYMENT_SOURCE.Cash) {
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: PAYMENT_STATUS.CashConfirmationRequired,
          totalChargedAmount: moneyString(totalAmount),
          paymentFailureReason: null,
        },
      });
      return { bookingId, status: PAYMENT_STATUS.CashConfirmationRequired };
    }

    if (booking.paymentSource === PAYMENT_SOURCE.Wallet) {
      return this.settleBookingFromCustomerWallet(
        bookingId,
        totalAmount,
        serviceAmount + tipAmount,
      );
    }

    return this.createStripeBookingCharge(bookingId, totalAmount, serviceAmount + tipAmount);
  }

  confirmCashCollection(input: ConfirmCashCollectionInput) {
    return this.taskerFinance.confirmCashCollection(input);
  }

  blockTaskerFinanceForDispute(
    bookingId: number,
    reason: string,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    return this.taskerFinance.blockForDispute(bookingId, reason, transaction);
  }

  async retryBookingPayment(
    customerId: number,
    bookingId: number,
    dto: RetryBookingPaymentDto,
  ): Promise<PaymentOrchestrationResult> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, customerId },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'completed') {
      throw new ConflictException('Payment retry is available only after task completion');
    }
    if (dto.paymentMethodId) {
      await this.assertPaymentMethodOwnedByCustomer(customerId, dto.paymentMethodId);
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: {
          stripePaymentMethodId: dto.paymentMethodId,
          paymentSource: PAYMENT_SOURCE.Stripe,
          paymentStatus: PAYMENT_STATUS.Ready,
          stripePaymentIntentId: null,
          paymentFailureReason: null,
        },
      });
    } else if (booking.stripePaymentIntentId) {
      const intent = await this.stripeProvider
        .client()
        .paymentIntents.retrieve(booking.stripePaymentIntentId);
      if (
        (intent.status === 'requires_action' ||
          intent.status === 'requires_confirmation' ||
          intent.status === 'requires_payment_method') &&
        intent.client_secret
      ) {
        return {
          bookingId,
          status:
            intent.status === 'requires_action'
              ? PAYMENT_STATUS.RequiresAction
              : PAYMENT_STATUS.Failed,
          paymentIntentId: intent.id,
          clientSecret: intent.client_secret,
        };
      }
    }
    return this.finalizeCompletedBooking(bookingId);
  }

  async issueDisputeRefund(input: BookingRefundRequest): Promise<BookingRefundResult> {
    const requestedAmount = roundMoney(input.amount);
    if (requestedAmount <= 0)
      throw new BadRequestException('Refund amount must be greater than zero');

    const prepared = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${input.bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findUnique({ where: { id: input.bookingId } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (!booking.totalChargedAmount || Number(booking.totalChargedAmount) <= 0) {
        throw new ConflictException('This booking has no settled charge that can be refunded');
      }
      if (
        ![PAYMENT_STATUS.Paid, PAYMENT_STATUS.PartiallyRefunded].includes(
          booking.paymentStatus as never,
        )
      ) {
        throw new ConflictException('Only paid or partially refunded bookings can be refunded');
      }

      const priorRefunds = await transaction.paymentTransaction.aggregate({
        where: {
          bookingId: booking.id,
          kind: PAYMENT_TRANSACTION_KIND.Refund,
          status: { in: ['processing', 'pending', 'succeeded'] },
        },
        _sum: { amount: true },
      });
      const refundable = roundMoney(
        Number(booking.totalChargedAmount) - Number(priorRefunds._sum.amount ?? 0),
      );
      if (requestedAmount > refundable + 0.0001) {
        throw new ConflictException(
          `Refund exceeds the remaining refundable amount of ${booking.paymentCurrency} ${refundable.toFixed(2)}`,
        );
      }

      const resolution = await transaction.disputeResolution.findFirst({
        where: { id: input.resolutionId, complaintId: input.complaintId },
      });
      if (!resolution) throw new NotFoundException('Dispute resolution not found');

      const idempotencyKey = `dispute-refund:${input.resolutionId}`;
      let payment = await transaction.paymentTransaction.findUnique({
        where: { idempotencyKey },
      });
      if (!payment) {
        payment = await transaction.paymentTransaction.create({
          data: {
            customerId: booking.customerId,
            bookingId: booking.id,
            kind: PAYMENT_TRANSACTION_KIND.Refund,
            provider:
              booking.paymentSource === PAYMENT_SOURCE.Wallet ? 'internal_wallet' : 'stripe',
            status: 'processing',
            amount: moneyString(requestedAmount),
            currency: booking.paymentCurrency,
            idempotencyKey,
            metadata: {
              complaintId: input.complaintId,
              resolutionId: input.resolutionId,
              actorId: input.actorId,
              summary: input.summary,
            },
          },
        });
        await transaction.disputeResolution.update({
          where: { id: resolution.id },
          data: {
            status: 'processing',
            refundTransactionId: payment.id,
            refundAmount: moneyString(requestedAmount),
            currency: booking.paymentCurrency,
            failureReason: null,
          },
        });
      }
      return { booking, payment, refundable, idempotencyKey };
    });

    if (prepared.payment.status === 'succeeded') {
      return this.refundResult(prepared.payment, input.resolutionId);
    }

    if (prepared.booking.paymentSource === PAYMENT_SOURCE.Wallet) {
      const settled = await this.settleWalletDisputeRefund(prepared.payment.id, input.resolutionId);
      return this.refundResult(settled, input.resolutionId);
    }

    if (!prepared.booking.stripePaymentIntentId) {
      await this.failDisputeRefund(
        prepared.payment.id,
        input.resolutionId,
        'The settled booking has no Stripe PaymentIntent reference',
      );
      throw new ConflictException(
        'Stripe refund cannot be created because the payment reference is missing',
      );
    }

    let refund: Stripe.Refund;
    try {
      if (prepared.payment.providerReference) {
        refund = await this.stripeProvider
          .client()
          .refunds.retrieve(prepared.payment.providerReference);
      } else {
        refund = await this.stripeProvider.client().refunds.create(
          {
            payment_intent: prepared.booking.stripePaymentIntentId,
            amount: toMinorUnits(requestedAmount),
            metadata: {
              latacheBookingId: String(prepared.booking.id),
              latacheComplaintId: input.complaintId,
              latacheResolutionId: input.resolutionId,
              latachePaymentTransactionId: prepared.payment.id,
            },
          },
          { idempotencyKey: prepared.idempotencyKey },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Stripe refund request failed';
      await this.failDisputeRefund(prepared.payment.id, input.resolutionId, message);
      throw error;
    }

    // The provider refund now exists. Do not mark it failed if our local synchronization
    // encounters a transient database error; the Stripe webhook can safely reconcile it.
    const transaction = await this.syncStripeRefundState(refund, prepared.payment.id);
    return this.refundResult(transaction, input.resolutionId);
  }

  async releaseDisputeHold(bookingId: number): Promise<PaymentOrchestrationResult> {
    const release = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findUnique({ where: { id: bookingId } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.paymentStatus !== PAYMENT_STATUS.OnHoldDispute) {
        const activeDisputes = await transaction.taskComplaint.count({
          where: {
            bookingId,
            status: { in: ['open', 'under_investigation', 'escalated'] },
          },
        });
        if (activeDisputes === 0) {
          await this.taskerFinance.unblockAfterDispute(bookingId, transaction);
        }
        return { bookingId, shouldFinalize: false, status: booking.paymentStatus };
      }
      const activeDisputes = await transaction.taskComplaint.count({
        where: {
          bookingId,
          status: { in: ['open', 'under_investigation', 'escalated'] },
        },
      });
      if (activeDisputes > 0) {
        return { bookingId, shouldFinalize: false, status: PAYMENT_STATUS.OnHoldDispute };
      }
      await transaction.booking.update({
        where: { id: bookingId },
        data: { paymentStatus: PAYMENT_STATUS.Ready, paymentFailureReason: null },
      });
      await this.taskerFinance.unblockAfterDispute(bookingId, transaction);
      return {
        bookingId,
        shouldFinalize: booking.status === 'completed',
        status: PAYMENT_STATUS.Ready,
      };
    });

    return release.shouldFinalize
      ? this.finalizeCompletedBooking(bookingId)
      : { bookingId, status: release.status };
  }

  private async settleWalletDisputeRefund(paymentTransactionId: string, resolutionId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const payment = await transaction.paymentTransaction.findUnique({
        where: { id: paymentTransactionId },
      });
      if (!payment?.bookingId) throw new NotFoundException('Refund transaction not found');
      if (payment.status === 'succeeded') return payment;

      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${payment.bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: payment.bookingId },
      });
      await this.ensureCustomerWallet(booking.customerId, transaction);
      await transaction.$queryRaw`
        SELECT "customerId" FROM "CustomerWallets"
        WHERE "customerId" = ${booking.customerId}
        FOR UPDATE
      `;

      const ledgerKey = `dispute-refund:${resolutionId}:customer`;
      const existingLedger = await transaction.customerWalletLedgerEntry.findUnique({
        where: { idempotencyKey: ledgerKey },
      });
      if (!existingLedger) {
        await transaction.customerWallet.update({
          where: { customerId: booking.customerId },
          data: { availableBalance: { increment: payment.amount } },
        });
        await transaction.customerWalletLedgerEntry.create({
          data: {
            customerId: booking.customerId,
            bookingId: booking.id,
            kind: CUSTOMER_WALLET_ENTRY_KIND.Refund,
            status: 'settled',
            amount: payment.amount,
            balanceDelta: payment.amount,
            currency: payment.currency,
            description: `Dispute refund for booking #${booking.id}`,
            providerReference: `wallet-refund:${resolutionId}`,
            idempotencyKey: ledgerKey,
          },
        });
      }

      const updatedPayment = await transaction.paymentTransaction.update({
        where: { id: payment.id },
        data: {
          status: 'succeeded',
          providerReference: `wallet-refund:${resolutionId}`,
          failureReason: null,
        },
      });
      await this.applyTaskerRefundClawback(transaction, booking, updatedPayment);
      await this.updateBookingRefundStatus(transaction, booking.id);
      await this.finalizeRefundResolution(
        transaction,
        resolutionId,
        updatedPayment,
        updatedPayment.providerReference,
        'succeeded',
      );
      return updatedPayment;
    });
  }

  private async syncStripeRefundState(refund: Stripe.Refund, paymentTransactionId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const payment = await transaction.paymentTransaction.findUnique({
        where: { id: paymentTransactionId },
      });
      if (!payment) throw new NotFoundException('Refund transaction not found');
      const status = this.mapRefundStatus(String(refund.status));
      const updatedPayment = await transaction.paymentTransaction.update({
        where: { id: payment.id },
        data: {
          providerReference: refund.id,
          status,
          failureReason: status === 'failed' ? `Stripe refund status: ${refund.status}` : null,
        },
      });
      const resolution = await transaction.disputeResolution.findFirst({
        where: { refundTransactionId: payment.id },
      });
      if (resolution) {
        await transaction.disputeResolution.update({
          where: { id: resolution.id },
          data: {
            providerRefundId: refund.id,
            providerRefundStatus: String(refund.status),
            status:
              status === 'succeeded' ? 'processing' : status === 'failed' ? 'failed' : 'processing',
            failureReason: status === 'failed' ? `Stripe refund status: ${refund.status}` : null,
          },
        });
      }
      if (status === 'succeeded' && payment.bookingId && resolution) {
        const booking = await transaction.booking.findUniqueOrThrow({
          where: { id: payment.bookingId },
        });
        await this.applyTaskerRefundClawback(transaction, booking, updatedPayment);
        await this.updateBookingRefundStatus(transaction, booking.id);
        await this.finalizeRefundResolution(
          transaction,
          resolution.id,
          updatedPayment,
          refund.id,
          String(refund.status),
        );
      } else if (status === 'failed' && resolution) {
        await this.failRefundResolutionInTransaction(
          transaction,
          resolution.id,
          `Stripe refund status: ${refund.status}`,
        );
      }
      return updatedPayment;
    });
  }

  private async handleRefundEvent(
    transaction: Prisma.TransactionClient,
    refund: Stripe.Refund,
  ): Promise<void> {
    let payment = await transaction.paymentTransaction.findFirst({
      where: {
        kind: PAYMENT_TRANSACTION_KIND.Refund,
        provider: 'stripe',
        providerReference: refund.id,
      },
    });
    if (!payment) {
      const paymentTransactionId = refund.metadata?.latachePaymentTransactionId;
      if (paymentTransactionId) {
        payment = await transaction.paymentTransaction.findUnique({
          where: { id: paymentTransactionId },
        });
      }
    }
    if (!payment) return;

    const status = this.mapRefundStatus(String(refund.status));
    const updatedPayment = await transaction.paymentTransaction.update({
      where: { id: payment.id },
      data: {
        providerReference: refund.id,
        status,
        failureReason: status === 'failed' ? `Stripe refund status: ${refund.status}` : null,
      },
    });
    const resolution = await transaction.disputeResolution.findFirst({
      where: { refundTransactionId: payment.id },
    });
    if (!resolution) return;

    await transaction.disputeResolution.update({
      where: { id: resolution.id },
      data: {
        providerRefundId: refund.id,
        providerRefundStatus: String(refund.status),
        status: status === 'failed' ? 'failed' : 'processing',
        failureReason: status === 'failed' ? `Stripe refund status: ${refund.status}` : null,
      },
    });

    if (status === 'succeeded' && updatedPayment.bookingId) {
      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: updatedPayment.bookingId },
      });
      await this.applyTaskerRefundClawback(transaction, booking, updatedPayment);
      await this.updateBookingRefundStatus(transaction, booking.id);
      await this.finalizeRefundResolution(
        transaction,
        resolution.id,
        updatedPayment,
        refund.id,
        String(refund.status),
      );
    } else if (status === 'failed') {
      await this.failRefundResolutionInTransaction(
        transaction,
        resolution.id,
        `Stripe refund status: ${refund.status}`,
      );
    }
  }

  private async applyTaskerRefundClawback(
    transaction: Prisma.TransactionClient,
    booking: {
      id: number;
      taskerId: number;
      serviceAmount: Prisma.Decimal | null;
      tipAmount: Prisma.Decimal;
      totalChargedAmount: Prisma.Decimal | null;
      paymentCurrency: string;
    },
    refundPayment: { id: string; amount: Prisma.Decimal },
  ): Promise<void> {
    if (await this.taskerFinance.applyRefundAdjustment(transaction, booking, refundPayment)) {
      return;
    }
    const earningTotal = roundMoney(Number(booking.serviceAmount ?? 0) + Number(booking.tipAmount));
    if (earningTotal <= 0) return;

    const existing = await transaction.taskerWalletLedgerEntry.findUnique({
      where: { idempotencyKey: `booking:${booking.id}:refund-clawback:${refundPayment.id}` },
    });
    if (existing) return;

    const priorClawbacks = await transaction.taskerWalletLedgerEntry.aggregate({
      where: {
        bookingId: booking.id,
        kind: WALLET_ENTRY_KIND.Refund,
        status: 'settled',
      },
      _sum: { amount: true },
    });
    const remainingTaskerEarning = Math.max(
      0,
      roundMoney(earningTotal - Number(priorClawbacks._sum.amount ?? 0)),
    );
    const totalCharged = roundMoney(Number(booking.totalChargedAmount ?? 0));
    const settledRefunds = await transaction.paymentTransaction.aggregate({
      where: {
        bookingId: booking.id,
        kind: PAYMENT_TRANSACTION_KIND.Refund,
        status: 'succeeded',
      },
      _sum: { amount: true },
    });
    const cumulativeRefunded = roundMoney(Number(settledRefunds._sum.amount ?? 0));
    const isFullyRefunded = totalCharged > 0 && cumulativeRefunded >= totalCharged - 0.005;
    const proportionalClawback =
      totalCharged > 0
        ? roundMoney((Number(refundPayment.amount) / totalCharged) * earningTotal)
        : roundMoney(Number(refundPayment.amount));
    const clawback = Math.min(
      isFullyRefunded ? remainingTaskerEarning : proportionalClawback,
      remainingTaskerEarning,
    );
    if (clawback <= 0) return;

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
    await transaction.taskerWallet.update({
      where: { taskerId: booking.taskerId },
      data: { availableBalance: { decrement: moneyString(clawback) } },
    });
    await transaction.taskerWalletLedgerEntry.create({
      data: {
        taskerId: booking.taskerId,
        bookingId: booking.id,
        kind: WALLET_ENTRY_KIND.Refund,
        status: 'settled',
        amount: moneyString(clawback),
        availableDelta: moneyString(-clawback),
        pendingDelta: '0.00',
        currency: booking.paymentCurrency,
        description: `Proportional refund adjustment for booking #${booking.id}`,
        externalReference: refundPayment.id,
        idempotencyKey: `booking:${booking.id}:refund-clawback:${refundPayment.id}`,
      },
    });
    await this.notifications.create(
      booking.taskerId,
      {
        category: 'wallet',
        type: 'booking_refund_adjustment',
        title: 'Booking refund adjustment',
        body: `${booking.paymentCurrency} ${clawback.toFixed(2)} was adjusted from your earnings because a booking refund settled.`,
        entityType: 'booking',
        entityId: String(booking.id),
      },
      transaction,
    );
  }

  private async updateBookingRefundStatus(
    transaction: Prisma.TransactionClient,
    bookingId: number,
  ): Promise<void> {
    const booking = await transaction.booking.findUniqueOrThrow({ where: { id: bookingId } });
    const refunds = await transaction.paymentTransaction.aggregate({
      where: {
        bookingId,
        kind: PAYMENT_TRANSACTION_KIND.Refund,
        status: 'succeeded',
      },
      _sum: { amount: true },
    });
    const totalRefunded = roundMoney(Number(refunds._sum.amount ?? 0));
    const totalCharged = roundMoney(Number(booking.totalChargedAmount ?? 0));
    await transaction.booking.update({
      where: { id: bookingId },
      data: {
        paymentStatus:
          totalCharged > 0 && totalRefunded >= totalCharged - 0.005
            ? PAYMENT_STATUS.Refunded
            : PAYMENT_STATUS.PartiallyRefunded,
      },
    });
  }

  private async finalizeRefundResolution(
    transaction: Prisma.TransactionClient,
    resolutionId: string,
    payment: { id: string; amount: Prisma.Decimal; currency: string },
    providerRefundId: string | null,
    providerRefundStatus: string,
  ): Promise<void> {
    const resolution = await transaction.disputeResolution.findUnique({
      where: { id: resolutionId },
      include: {
        complaint: { include: { booking: true } },
      },
    });
    if (!resolution || resolution.status === 'applied') return;
    const now = new Date();
    await transaction.disputeResolution.update({
      where: { id: resolution.id },
      data: {
        status: 'applied',
        refundTransactionId: payment.id,
        providerRefundId,
        providerRefundStatus,
        failureReason: null,
        appliedAt: now,
      },
    });
    await transaction.taskComplaint.update({
      where: { id: resolution.complaintId },
      data: {
        status: 'resolved',
        resolvedAt: now,
        resolvedById: resolution.actorId,
        resolutionType: resolution.actionType,
        resolutionSummary: resolution.summary,
        resolutionAmount: payment.amount,
        resolutionCurrency: payment.currency,
        awaitingResponseFrom: null,
        responseDueAt: null,
      },
    });
    await this.taskerFinance.unblockAfterDispute(resolution.complaint.bookingId, transaction);
    await transaction.adminAuditLog.create({
      data: {
        actorId: resolution.actorId,
        targetUserId: null,
        action: 'dispute_refund_resolved',
        entityType: 'dispute',
        entityId: resolution.complaintId,
        reason: resolution.summary,
        metadata: {
          bookingId: resolution.complaint.bookingId,
          actionType: resolution.actionType,
          refundAmount: Number(payment.amount),
          currency: payment.currency,
          providerRefundId,
          providerRefundStatus,
        },
      },
    });
    await this.recordWarningAuditIfNeeded(transaction, resolution, resolution.complaint.booking);
    if (resolution.notifyParties) {
      await this.notifyDisputeResolved(
        transaction,
        resolution.complaint.booking.customerId,
        resolution.complaint.booking.taskerId,
        resolution.complaintId,
        resolution.summary,
      );
    }
  }

  private async recordWarningAuditIfNeeded(
    transaction: Prisma.TransactionClient,
    resolution: {
      actorId: number;
      actionType: string;
      warningTarget: string | null;
      complaintId: string;
      summary: string;
    },
    booking: { customerId: number; taskerId: number },
  ): Promise<void> {
    if (!resolution.actionType.includes('warning') || !resolution.warningTarget) return;
    const targets =
      resolution.warningTarget === 'both'
        ? [booking.customerId, booking.taskerId]
        : resolution.warningTarget === 'customer'
          ? [booking.customerId]
          : [booking.taskerId];
    for (const targetUserId of targets) {
      await transaction.adminAuditLog.create({
        data: {
          actorId: resolution.actorId,
          targetUserId,
          action: 'dispute_warning_issued',
          entityType: 'dispute',
          entityId: resolution.complaintId,
          reason: resolution.summary,
        },
      });
    }
  }

  private async notifyDisputeResolved(
    transaction: Prisma.TransactionClient,
    customerId: number,
    taskerId: number,
    complaintId: string,
    summary: string,
  ): Promise<void> {
    for (const userId of [customerId, taskerId]) {
      await this.notifications.create(
        userId,
        {
          category: 'tasks',
          type: 'booking_dispute_resolved',
          title: 'Booking dispute resolved',
          body: summary.slice(0, 500),
          entityType: 'dispute',
          entityId: complaintId,
        },
        transaction,
      );
    }
  }

  private async failDisputeRefund(
    paymentTransactionId: string,
    resolutionId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.paymentTransaction.updateMany({
        where: { id: paymentTransactionId, status: { not: 'succeeded' } },
        data: { status: 'failed', failureReason: reason.slice(0, 1000) },
      });
      await this.failRefundResolutionInTransaction(transaction, resolutionId, reason);
    });
  }

  private async failRefundResolutionInTransaction(
    transaction: Prisma.TransactionClient,
    resolutionId: string,
    reason: string,
  ): Promise<void> {
    const resolution = await transaction.disputeResolution.findUnique({
      where: { id: resolutionId },
      include: { complaint: true },
    });
    if (!resolution || resolution.status === 'applied') return;
    await transaction.disputeResolution.update({
      where: { id: resolution.id },
      data: { status: 'failed', failureReason: reason.slice(0, 1000) },
    });
    if (resolution.complaint.status === 'resolved') {
      await transaction.taskComplaint.update({
        where: { id: resolution.complaintId },
        data: {
          status: 'under_investigation',
          resolvedAt: null,
          resolvedById: null,
          resolutionType: null,
          resolutionSummary: null,
          resolutionAmount: null,
          resolutionCurrency: null,
        },
      });
    }
    await this.notifications.create(
      resolution.actorId,
      {
        category: 'system',
        type: 'dispute_refund_failed',
        title: 'Dispute refund failed',
        body: reason.slice(0, 500),
        entityType: 'dispute',
        entityId: resolution.complaintId,
      },
      transaction,
    );
  }

  private mapRefundStatus(status: string): 'succeeded' | 'processing' | 'failed' {
    if (status === 'succeeded') return 'succeeded';
    if (status === 'failed' || status === 'canceled') return 'failed';
    return 'processing';
  }

  private refundResult(
    payment: {
      id: string;
      provider: string;
      providerReference: string | null;
      status: string;
      amount: Prisma.Decimal;
      currency: string;
      bookingId: number | null;
    },
    resolutionId: string,
  ): BookingRefundResult {
    if (!payment.bookingId)
      throw new ConflictException('Refund transaction is not linked to a booking');
    return {
      bookingId: payment.bookingId,
      resolutionId,
      transactionId: payment.id,
      provider: payment.provider,
      providerReference: payment.providerReference,
      status: payment.status,
      amount: { amount: Number(payment.amount), currency: payment.currency },
    };
  }

  async handleStripeEvent(event: Stripe.Event): Promise<{ received: true; duplicate: boolean }> {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.stripeWebhookEvent.create({
          data: { id: event.id, type: event.type },
        });

        if (
          event.type === 'payment_intent.succeeded' ||
          event.type === 'payment_intent.payment_failed'
        ) {
          const intent = event.data.object as Stripe.PaymentIntent;
          const kind = intent.metadata.kind;
          if (kind === PAYMENT_TRANSACTION_KIND.WalletTopup) {
            await this.handleTopupIntent(transaction, intent, event.type);
          } else if (kind === PAYMENT_TRANSACTION_KIND.BookingCharge) {
            await this.handleBookingIntent(transaction, intent, event.type);
          }
        } else if (
          event.type === 'refund.created' ||
          event.type === 'refund.updated' ||
          event.type === 'refund.failed'
        ) {
          await this.handleRefundEvent(transaction, event.data.object as Stripe.Refund);
        }

        return { received: true as const, duplicate: false };
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        return { received: true, duplicate: true };
      }
      throw error;
    }
  }

  private async handleTopupIntent(
    transaction: Prisma.TransactionClient,
    intent: Stripe.PaymentIntent,
    eventType: string,
  ): Promise<void> {
    const customerId = Number(intent.metadata.latacheCustomerId);
    if (!Number.isInteger(customerId) || customerId <= 0) {
      throw new BadRequestException('Stripe wallet top-up metadata is invalid');
    }
    const row = await transaction.paymentTransaction.findFirst({
      where: {
        customerId,
        providerReference: intent.id,
        kind: PAYMENT_TRANSACTION_KIND.WalletTopup,
      },
    });
    if (!row) {
      throw new NotFoundException('Wallet top-up transaction not found');
    }

    if (eventType === 'payment_intent.payment_failed') {
      await transaction.paymentTransaction.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          failureReason: intent.last_payment_error?.message ?? 'Stripe payment failed',
        },
      });
      await this.notifications.create(
        customerId,
        {
          category: 'payments',
          type: 'wallet_topup_failed',
          title: 'Wallet top-up failed',
          body: 'Stripe could not complete the wallet top-up.',
          entityType: 'payment_transaction',
          entityId: row.id,
        },
        transaction,
      );
      return;
    }

    await this.ensureCustomerWallet(customerId, transaction);
    await transaction.$queryRaw`
      SELECT "customerId" FROM "CustomerWallets"
      WHERE "customerId" = ${customerId}
      FOR UPDATE
    `;
    const ledgerKey = `stripe:wallet-topup:${intent.id}`;
    const existingLedger = await transaction.customerWalletLedgerEntry.findUnique({
      where: { idempotencyKey: ledgerKey },
    });
    if (!existingLedger) {
      await transaction.customerWallet.update({
        where: { customerId },
        data: { availableBalance: { increment: row.amount } },
      });
      await transaction.customerWalletLedgerEntry.create({
        data: {
          customerId,
          kind: CUSTOMER_WALLET_ENTRY_KIND.Topup,
          status: 'settled',
          amount: row.amount,
          balanceDelta: row.amount,
          currency: row.currency,
          description: 'Stripe wallet top-up',
          providerReference: intent.id,
          idempotencyKey: ledgerKey,
        },
      });
    }
    await transaction.paymentTransaction.update({
      where: { id: row.id },
      data: { status: 'succeeded', failureReason: null },
    });
    await this.notifications.create(
      customerId,
      {
        category: 'wallet',
        type: 'wallet_topup_succeeded',
        title: 'Wallet balance updated',
        body: `${row.currency} ${Number(row.amount).toFixed(2)} was added to your Latache wallet.`,
        entityType: 'payment_transaction',
        entityId: row.id,
      },
      transaction,
    );
  }

  private async handleBookingIntent(
    transaction: Prisma.TransactionClient,
    intent: Stripe.PaymentIntent,
    eventType: string,
  ): Promise<void> {
    const bookingId = Number(intent.metadata.latacheBookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
      throw new BadRequestException('Stripe booking metadata is invalid');
    }
    await transaction.$queryRaw`
      SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE
    `;
    const booking = await transaction.booking.findUnique({ where: { id: bookingId } });
    if (!booking || booking.stripePaymentIntentId !== intent.id) {
      throw new NotFoundException('Booking payment record not found');
    }

    const paymentRow = await transaction.paymentTransaction.findFirst({
      where: { bookingId, providerReference: intent.id },
    });
    const existingEarning = await transaction.taskerEarning.findUnique({
      where: { bookingId },
      select: { id: true },
    });

    if (eventType === 'payment_intent.payment_failed') {
      await transaction.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: PAYMENT_STATUS.Failed,
          paymentFailureReason: intent.last_payment_error?.message ?? 'Stripe payment failed',
        },
      });
      if (paymentRow) {
        await transaction.paymentTransaction.update({
          where: { id: paymentRow.id },
          data: {
            status: 'failed',
            failureReason: intent.last_payment_error?.message ?? 'Stripe payment failed',
          },
        });
      }
      await this.notifications.create(
        booking.customerId,
        {
          category: 'payments',
          type: 'booking_payment_failed',
          title: 'Payment needs attention',
          body: 'The final task payment could not be completed. Update the payment method and retry.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      return;
    }

    const amountReceived = roundMoney(intent.amount_received / 100);
    await transaction.booking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: PAYMENT_STATUS.Paid,
        totalChargedAmount: moneyString(amountReceived),
        paidAt: new Date(),
        paymentFailureReason: null,
      },
    });
    if (paymentRow) {
      await transaction.paymentTransaction.update({
        where: { id: paymentRow.id },
        data: { status: 'succeeded', failureReason: null },
      });
    }

    await this.creditTaskerWallet(
      transaction,
      booking.taskerId,
      booking.id,
      Number(booking.serviceAmount ?? 0) + Number(booking.tipAmount),
      booking.paymentCurrency,
      intent.id,
    );
    if (!existingEarning) {
      await this.notifications.create(
        booking.customerId,
        {
          category: 'payments',
          type: 'booking_payment_succeeded',
          title: 'Task payment completed',
          body: `${booking.paymentCurrency} ${amountReceived.toFixed(2)} was charged for your completed task.`,
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
    }
  }

  private async createStripeBookingCharge(
    bookingId: number,
    totalAmount: number,
    taskerEarning: number,
  ): Promise<PaymentOrchestrationResult> {
    const booking = await this.prisma.booking.findUniqueOrThrow({
      where: { id: bookingId },
      include: { customer: true },
    });
    if (!booking.stripePaymentMethodId) {
      await this.prisma.booking.update({
        where: { id: bookingId },
        data: { paymentStatus: PAYMENT_STATUS.PaymentMethodRequired },
      });
      return { bookingId, status: PAYMENT_STATUS.PaymentMethodRequired };
    }
    await this.assertPaymentMethodOwnedByCustomer(
      booking.customerId,
      booking.stripePaymentMethodId,
    );
    const stripeCustomerId = await this.ensureStripeCustomer(booking.customerId);
    const idempotencyKey = `booking-charge:${bookingId}:v1`;

    const existingTransaction = await this.prisma.paymentTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existingTransaction?.providerReference) {
      const intent = await this.stripeProvider
        .client()
        .paymentIntents.retrieve(existingTransaction.providerReference);
      if (intent.status === 'succeeded') {
        await this.prisma.$transaction((transaction) =>
          this.handleBookingIntent(transaction, intent, 'payment_intent.succeeded'),
        );
      }
      return {
        bookingId,
        status: this.mapStripeIntentStatus(intent.status),
        paymentIntentId: intent.id,
        clientSecret:
          intent.status === 'requires_action' || intent.status === 'requires_payment_method'
            ? intent.client_secret
            : undefined,
      };
    }

    try {
      const intent = await this.stripeProvider.client().paymentIntents.create(
        {
          amount: toMinorUnits(totalAmount),
          currency: this.currency.toLowerCase(),
          customer: stripeCustomerId,
          payment_method: booking.stripePaymentMethodId,
          confirm: true,
          off_session: true,
          description: `Latache booking #${bookingId}`,
          metadata: {
            kind: PAYMENT_TRANSACTION_KIND.BookingCharge,
            latacheBookingId: String(bookingId),
            latacheCustomerId: String(booking.customerId),
            latacheTaskerId: String(booking.taskerId),
            taskerEarning: moneyString(taskerEarning),
          },
        },
        { idempotencyKey },
      );

      await this.prisma.$transaction(async (transaction) => {
        await transaction.booking.update({
          where: { id: bookingId },
          data: {
            stripePaymentIntentId: intent.id,
            paymentStatus: this.mapStripeIntentStatus(intent.status),
            totalChargedAmount: intent.status === 'succeeded' ? moneyString(totalAmount) : null,
          },
        });
        await transaction.paymentTransaction.upsert({
          where: { idempotencyKey },
          create: {
            customerId: booking.customerId,
            bookingId,
            kind: PAYMENT_TRANSACTION_KIND.BookingCharge,
            provider: 'stripe',
            providerReference: intent.id,
            status: intent.status,
            amount: moneyString(totalAmount),
            currency: this.currency,
            idempotencyKey,
            metadata: {
              taskerEarning: moneyString(taskerEarning),
            },
          },
          update: {
            providerReference: intent.id,
            status: intent.status,
            amount: moneyString(totalAmount),
          },
        });
        if (intent.status === 'succeeded') {
          await this.handleBookingIntent(transaction, intent, 'payment_intent.succeeded');
        }
      });

      return {
        bookingId,
        status: this.mapStripeIntentStatus(intent.status),
        paymentIntentId: intent.id,
        clientSecret:
          intent.status === 'requires_action' || intent.status === 'requires_payment_method'
            ? intent.client_secret
            : undefined,
      };
    } catch (error) {
      const intent = this.paymentIntentFromStripeError(error);
      if (intent) {
        await this.prisma.$transaction(async (transaction) => {
          await transaction.booking.update({
            where: { id: bookingId },
            data: {
              stripePaymentIntentId: intent.id,
              paymentStatus: this.mapStripeIntentStatus(intent.status),
              paymentFailureReason:
                intent.last_payment_error?.message ?? 'Stripe requires payment action',
            },
          });
          await transaction.paymentTransaction.upsert({
            where: { idempotencyKey },
            create: {
              customerId: booking.customerId,
              bookingId,
              kind: PAYMENT_TRANSACTION_KIND.BookingCharge,
              provider: 'stripe',
              providerReference: intent.id,
              status: intent.status,
              amount: moneyString(totalAmount),
              currency: this.currency,
              failureReason: intent.last_payment_error?.message ?? null,
              idempotencyKey,
            },
            update: {
              providerReference: intent.id,
              status: intent.status,
              failureReason: intent.last_payment_error?.message ?? null,
            },
          });
        });
        return {
          bookingId,
          status: this.mapStripeIntentStatus(intent.status),
          paymentIntentId: intent.id,
          clientSecret: intent.client_secret,
        };
      }
      throw error;
    }
  }

  private async settleBookingFromCustomerWallet(
    bookingId: number,
    totalAmount: number,
    taskerEarning: number,
  ): Promise<PaymentOrchestrationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE
      `;
      if (rows.length === 0) throw new NotFoundException('Booking not found');
      const booking = await transaction.booking.findUniqueOrThrow({ where: { id: bookingId } });
      if (booking.paymentStatus === PAYMENT_STATUS.Paid) {
        return { bookingId, status: PAYMENT_STATUS.Paid };
      }

      await this.ensureCustomerWallet(booking.customerId, transaction);
      await transaction.$queryRaw`
        SELECT "customerId" FROM "CustomerWallets"
        WHERE "customerId" = ${booking.customerId}
        FOR UPDATE
      `;
      const wallet = await transaction.customerWallet.findUniqueOrThrow({
        where: { customerId: booking.customerId },
      });
      if (Number(wallet.availableBalance) < totalAmount) {
        await transaction.booking.update({
          where: { id: bookingId },
          data: {
            paymentStatus: PAYMENT_STATUS.PaymentMethodRequired,
            paymentFailureReason: 'Customer wallet balance is insufficient',
          },
        });
        return { bookingId, status: PAYMENT_STATUS.PaymentMethodRequired };
      }

      const idempotencyKey = `wallet:booking:${bookingId}:debit`;
      const existing = await transaction.customerWalletLedgerEntry.findUnique({
        where: { idempotencyKey },
      });
      if (!existing) {
        await transaction.customerWallet.update({
          where: { customerId: booking.customerId },
          data: { availableBalance: { decrement: moneyString(totalAmount) } },
        });
        await transaction.customerWalletLedgerEntry.create({
          data: {
            customerId: booking.customerId,
            bookingId,
            kind: CUSTOMER_WALLET_ENTRY_KIND.BookingDebit,
            status: 'settled',
            amount: moneyString(totalAmount),
            balanceDelta: moneyString(-totalAmount),
            currency: booking.paymentCurrency,
            description: `Payment for booking #${bookingId}`,
            providerReference: `wallet:${bookingId}`,
            idempotencyKey,
          },
        });
        await transaction.paymentTransaction.create({
          data: {
            customerId: booking.customerId,
            bookingId,
            kind: PAYMENT_TRANSACTION_KIND.BookingCharge,
            provider: 'internal_wallet',
            providerReference: `wallet:${bookingId}`,
            status: 'succeeded',
            amount: moneyString(totalAmount),
            currency: booking.paymentCurrency,
            idempotencyKey: `payment:${idempotencyKey}`,
          },
        });
      }

      await transaction.booking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: PAYMENT_STATUS.Paid,
          totalChargedAmount: moneyString(totalAmount),
          paidAt: new Date(),
          paymentFailureReason: null,
        },
      });
      await this.creditTaskerWallet(
        transaction,
        booking.taskerId,
        booking.id,
        taskerEarning,
        booking.paymentCurrency,
        `wallet:${bookingId}`,
      );
      await this.notifications.create(
        booking.customerId,
        {
          category: 'payments',
          type: 'booking_wallet_payment_succeeded',
          title: 'Task payment completed',
          body: `${booking.paymentCurrency} ${totalAmount.toFixed(2)} was paid from your Latache wallet.`,
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      return { bookingId, status: PAYMENT_STATUS.Paid };
    });
  }

  private async creditTaskerWallet(
    transaction: Prisma.TransactionClient,
    taskerId: number,
    bookingId: number,
    amountInput: number,
    currencyInput: string,
    externalReference: string,
  ): Promise<void> {
    void taskerId;
    void currencyInput;
    const booking = await transaction.booking.findUniqueOrThrow({
      where: { id: bookingId },
    });
    await this.taskerFinance.createPendingEarning({
      booking,
      grossCustomerAmount: roundMoney(Number(booking.totalChargedAmount ?? amountInput)),
      providerSettlementReference: externalReference,
      settledAt: new Date(),
      transaction,
    });
  }

  private async ensureStripeCustomer(customerId: number): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        role: true,
        email: true,
        firstName: true,
        lastName: true,
        phoneCountryCode: true,
        phoneNumber: true,
        stripeCustomerId: true,
      },
    });
    if (!user || user.role !== 'customer') {
      throw new NotFoundException('Customer account not found');
    }
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const stripe = this.stripeProvider.client();
    const created = await stripe.customers.create(
      {
        email: user.email,
        name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || undefined,
        phone: `${user.phoneCountryCode ?? ''}${user.phoneNumber ?? ''}` || undefined,
        metadata: { latacheCustomerId: String(user.id) },
      },
      { idempotencyKey: `latache:stripe-customer:${user.id}` },
    );
    await this.prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: created.id },
    });
    return created.id;
  }

  private async assertStripePaymentMethodOwnership(
    stripeCustomerId: string,
    paymentMethodId: string,
  ): Promise<Stripe.PaymentMethod> {
    const method = await this.stripeProvider.client().paymentMethods.retrieve(paymentMethodId);
    const owner =
      typeof method.customer === 'string' ? method.customer : (method.customer?.id ?? null);
    if (owner !== stripeCustomerId) {
      throw new BadRequestException(
        'Stripe PaymentMethod does not belong to the authenticated customer',
      );
    }
    if (method.type !== 'card') {
      throw new BadRequestException('Only Stripe card payment methods are supported currently');
    }
    return method;
  }

  private async ensureCustomerWallet(customerId: number, transaction?: Prisma.TransactionClient) {
    const client = transaction ?? this.prisma;
    return client.customerWallet.upsert({
      where: { customerId },
      create: { customerId, currency: this.currency },
      update: {},
    });
  }

  private mapStripeIntentStatus(status: Stripe.PaymentIntent.Status): string {
    if (status === 'succeeded') return PAYMENT_STATUS.Processing;
    if (status === 'processing') return PAYMENT_STATUS.Processing;
    if (status === 'requires_action') return PAYMENT_STATUS.RequiresAction;
    if (status === 'requires_payment_method') return PAYMENT_STATUS.Failed;
    return status;
  }

  private paymentIntentFromStripeError(error: unknown): Stripe.PaymentIntent | null {
    const raw = error as {
      payment_intent?: Stripe.PaymentIntent;
      raw?: { payment_intent?: Stripe.PaymentIntent };
    };
    return raw.payment_intent ?? raw.raw?.payment_intent ?? null;
  }

  private serializeTransaction(row: {
    id: string;
    kind: string;
    provider: string;
    providerReference: string | null;
    bookingId: number | null;
    status: string;
    amount: Prisma.Decimal;
    currency: string;
    failureReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): PaymentTransactionView {
    return {
      id: row.id,
      kind: row.kind,
      provider: row.provider,
      providerReference: row.providerReference,
      bookingId: row.bookingId ? String(row.bookingId) : null,
      status: row.status,
      amount: { amount: Number(row.amount), currency: row.currency },
      failureReason: row.failureReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private serializeBookingPayment(booking: {
    id: number;
    paymentSource: string;
    paymentStatus: string;
    paymentCurrency: string;
    stripePaymentMethodId: string | null;
    stripePaymentIntentId: string | null;
    serviceAmount: Prisma.Decimal | null;
    platformFeeAmount: Prisma.Decimal;
    commissionRatePercent: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    taxRatePercent: Prisma.Decimal;
    taxInclusive: boolean;
    serviceSurchargeAmount: Prisma.Decimal;
    tipAmount: Prisma.Decimal;
    donationAmount: Prisma.Decimal;
    totalChargedAmount: Prisma.Decimal | null;
    paymentFailureReason: string | null;
    paidAt: Date | null;
  }): BookingPaymentStatusView {
    return {
      bookingId: String(booking.id),
      source: booking.paymentSource,
      status: booking.paymentStatus,
      currency: booking.paymentCurrency,
      paymentMethodId: booking.stripePaymentMethodId,
      paymentIntentId: booking.stripePaymentIntentId,
      serviceAmount: booking.serviceAmount === null ? null : Number(booking.serviceAmount),
      platformFeeAmount: Number(booking.platformFeeAmount),
      commissionRatePercent: Number(booking.commissionRatePercent),
      taxAmount: Number(booking.taxAmount),
      taxRatePercent: Number(booking.taxRatePercent),
      taxInclusive: booking.taxInclusive,
      serviceSurchargeAmount: Number(booking.serviceSurchargeAmount),
      tipAmount: Number(booking.tipAmount),
      donationAmount: Number(booking.donationAmount),
      totalChargedAmount:
        booking.totalChargedAmount === null ? null : Number(booking.totalChargedAmount),
      failureReason: booking.paymentFailureReason,
      paidAt: booking.paidAt?.toISOString() ?? null,
    };
  }
}
