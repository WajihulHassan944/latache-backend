import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { PLATFORM_CURRENCY_PRESETS } from '../platform-settings/platform-currency.presets';

export const FINANCE_EXPORT_DATASETS = [
  'transactions',
  'invoices',
  'platform-fees',
  'tasker-earnings',
  'tasker-payouts',
  'customer-withdrawals',
  'tasker-deposits',
] as const;
export type FinanceExportDataset = (typeof FINANCE_EXPORT_DATASETS)[number];

const MAX_EXPORT_ROWS = 50_000;
const num = (value: Prisma.Decimal | number | null | undefined): number => (value === null || value === undefined ? 0 : Number(value));
const r2 = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const name = (person: { firstName: string | null; lastName: string | null } | null | undefined) =>
  person ? `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() : '';
const iso = (date: Date | null | undefined) => (date ? date.toISOString() : '');

/** RFC 4180 CSV with a UTF-8 BOM so Excel opens accents/Arabic correctly; neutralises formula injection. */
export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const cell = (value: unknown): string => {
    let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
    if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${[headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

/**
 * Finance read models for the admin dashboard and the accountant:
 * one overview of money in / owed / held, and CSV exports per dataset.
 */
@Injectable()
export class FinanceReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  /** Rate to the canonical USD unit for an ISO code (static presets); unknown codes count as 1. */
  private rateFromUsd(code: string): number {
    const preset = Object.values(PLATFORM_CURRENCY_PRESETS).find((entry) => entry.code === code.toUpperCase());
    return preset?.rateFromUsd ?? 1;
  }

  private range(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
    if (!from && !to) return undefined;
    const gte = from ? new Date(`${from}T00:00:00.000Z`) : undefined;
    const lte = to ? new Date(`${to}T23:59:59.999Z`) : undefined;
    if ((gte && Number.isNaN(gte.getTime())) || (lte && Number.isNaN(lte.getTime()))) {
      throw new BadRequestException('from/to must be YYYY-MM-DD');
    }
    return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
  }

  async overview(from?: string, to?: string) {
    const period = this.range(from, to);
    const paidWhere: Prisma.BookingWhereInput = {
      status: 'completed',
      paymentStatus: { in: ['paid', 'cash_confirmed', 'partially_refunded'] },
      ...(period ? { taskCompletedAt: period } : {}),
    };
    const [
      completed,
      cancellationFees,
      transactions,
      taskerWallets,
      customerWallets,
      taskerPayouts,
      customerWithdrawals,
      deposits,
      cashPayables,
      invoices,
      earnings,
    ] = await Promise.all([
      this.prisma.booking.groupBy({
        by: ['paymentCurrency', 'paymentSource'],
        where: paidWhere,
        _sum: { totalChargedAmount: true, platformFeeAmount: true, serviceAmount: true, taxAmount: true, tipAmount: true },
        _count: { _all: true },
      }),
      this.prisma.booking.groupBy({
        by: ['paymentCurrency'],
        where: { status: 'cancelled', cancellationFeeAmount: { gt: 0 }, ...(period ? { cancelledAt: period } : {}) },
        _sum: { cancellationFeeAmount: true },
        _count: { _all: true },
      }),
      this.prisma.paymentTransaction.groupBy({
        by: ['kind', 'provider', 'currency'],
        where: { status: 'succeeded', ...(period ? { createdAt: period } : {}) },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.taskerWallet.groupBy({ by: ['currency'], _sum: { availableBalance: true, pendingBalance: true } }),
      this.prisma.customerWallet.groupBy({ by: ['currency'], _sum: { availableBalance: true } }),
      this.prisma.taskerWithdrawal.groupBy({
        by: ['status', 'currency'],
        where: { status: { in: ['pending_review', 'processing'] } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.customerWithdrawal.groupBy({
        by: ['status', 'currency'],
        where: { status: { in: ['pending_review', 'processing'] } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.taskerDeposit.groupBy({ by: ['status', 'currency'], _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.taskerPlatformAccount.groupBy({ by: ['currency'], where: { outstandingPayable: { gt: 0 } }, _sum: { outstandingPayable: true }, _count: { _all: true } }),
      this.prisma.invoice.groupBy({
        by: ['type', 'currency'],
        where: { status: 'issued', ...(period ? { issuedAt: period } : {}) },
        _sum: { total: true },
        _count: { _all: true },
      }),
      this.prisma.taskerEarning.groupBy({
        by: ['currency'],
        where: period ? { createdAt: period } : {},
        _sum: { taskerNetAmount: true, platformCommissionAmount: true, reversedAmount: true },
      }),
    ]);

    // One platform currency in every report: records written in an older currency
    // (the USD-era bookings) are converted at the platform's static rate and folded
    // into the same bucket, so the admin sees a single total instead of two blocks.
    const target = (await this.platformSettings.currencyContext()).code;
    const COUNT_KEYS = new Set(['completedBookings', 'lateCancellations', 'taskersWithCashDebt', 'taskerPayoutRequestsInQueue', 'customerWithdrawalRequestsInQueue', 'taskerDepositsAwaitingPayment', 'invoicesIssued']);
    const toTarget = (currency: string, value: number): number =>
      currency.toUpperCase() === target ? value : (value / this.rateFromUsd(currency)) * this.rateFromUsd(target);
    const byCurrency = new Map<string, Record<string, number>>();
    const bucket = () => {
      if (!byCurrency.has(target)) byCurrency.set(target, {});
      return byCurrency.get(target) as Record<string, number>;
    };
    const add = (currency: string, key: string, value: number) => {
      const b = bucket();
      const amount = COUNT_KEYS.has(key) ? value : toTarget(currency, value);
      b[key] = r2((b[key] ?? 0) + amount);
    };
    for (const row of completed) {
      add(row.paymentCurrency, 'completedBookings', row._count._all);
      add(row.paymentCurrency, 'grossBookingValue', num(row._sum.totalChargedAmount));
      add(row.paymentCurrency, 'platformFeesEarned', num(row._sum.platformFeeAmount));
      add(row.paymentCurrency, 'serviceValue', num(row._sum.serviceAmount));
      add(row.paymentCurrency, 'taxCollected', num(row._sum.taxAmount));
      add(row.paymentCurrency, 'tips', num(row._sum.tipAmount));
      if (row.paymentSource === 'cash') add(row.paymentCurrency, 'collectedInCashByTaskers', num(row._sum.totalChargedAmount));
    }
    for (const row of cancellationFees) {
      add(row.paymentCurrency, 'lateCancellationFeesEarned', num(row._sum.cancellationFeeAmount));
      add(row.paymentCurrency, 'lateCancellations', row._count._all);
    }
    for (const row of earnings) {
      add(row.currency, 'taskerNetEarnings', num(row._sum.taskerNetAmount));
      add(row.currency, 'earningReversals', num(row._sum.reversedAmount));
    }
    for (const row of taskerWallets) {
      add(row.currency, 'owedToTaskersAvailable', num(row._sum.availableBalance));
      add(row.currency, 'owedToTaskersPending', num(row._sum.pendingBalance));
    }
    for (const row of customerWallets) add(row.currency, 'customerWalletBalances', num(row._sum.availableBalance));
    for (const row of cashPayables) {
      add(row.currency, 'cashCommissionOwedByTaskers', num(row._sum.outstandingPayable));
      add(row.currency, 'taskersWithCashDebt', row._count._all);
    }
    for (const row of taskerPayouts) {
      add(row.currency, 'taskerPayoutsInQueue', num(row._sum.amount));
      add(row.currency, 'taskerPayoutRequestsInQueue', row._count._all);
    }
    for (const row of customerWithdrawals) {
      add(row.currency, 'customerWithdrawalsInQueue', num(row._sum.amount));
      add(row.currency, 'customerWithdrawalRequestsInQueue', row._count._all);
    }
    for (const row of deposits) {
      if (row.status === 'paid') add(row.currency, 'taskerDepositsHeld', num(row._sum.amount));
      if (row.status === 'pending') add(row.currency, 'taskerDepositsAwaitingPayment', row._count._all);
    }
    for (const row of invoices) {
      add(row.currency, row.type === 'booking' ? 'bookingInvoicesTotal' : 'depositInvoicesTotal', num(row._sum.total));
      add(row.currency, 'invoicesIssued', row._count._all);
    }
    for (const [currency, values] of byCurrency) {
      values.platformRevenue = r2((values.platformFeesEarned ?? 0) + (values.lateCancellationFeesEarned ?? 0));
    }

    return {
      period: { from: from ?? null, to: to ?? null },
      currencies: [...byCurrency.entries()].map(([currency, values]) => ({ currency, ...values })),
      moneyMovements: [
        ...transactions
          .reduce((map, row) => {
            const key = `${row.kind}:${row.provider}`;
            const entry = map.get(key) ?? { kind: row.kind, provider: row.provider, currency: target, count: 0, amount: 0 };
            entry.count += row._count._all;
            entry.amount = r2(entry.amount + toTarget(row.currency, num(row._sum.amount)));
            return map.set(key, entry);
          }, new Map<string, { kind: string; provider: string; currency: string; count: number; amount: number }>())
          .values(),
      ],
      definitions: {
        platformRevenue: 'Platform fees on completed bookings + late-cancellation fees kept.',
        owedToTaskersAvailable: 'Tasker wallet balances that can be withdrawn now (a liability).',
        owedToTaskersPending: 'Tasker earnings still in the clearance period (a liability).',
        customerWalletBalances: 'Money customers hold in their Latache wallet (a liability).',
        cashCommissionOwedByTaskers: 'Platform fees on cash jobs that Taskers still have to pay the platform.',
        taskerDepositsHeld: 'Refundable signup deposits currently held (a liability).',
      },
    };
  }

  async export(dataset: FinanceExportDataset, from?: string, to?: string): Promise<{ filename: string; csv: string }> {
    const period = this.range(from, to);
    const suffix = `${from ?? 'all'}_${to ?? 'now'}`;
    const filename = `latache-${dataset}-${suffix}.csv`;
    switch (dataset) {
      case 'transactions': {
        const rows = await this.prisma.paymentTransaction.findMany({
          where: period ? { createdAt: period } : {},
          include: { customer: { select: { email: true, firstName: true, lastName: true } } },
          orderBy: { createdAt: 'asc' },
          take: MAX_EXPORT_ROWS,
        });
        return {
          filename,
          csv: toCsv(
            ['date', 'transaction_id', 'kind', 'provider', 'status', 'amount', 'currency', 'booking_id', 'user_id', 'user_name', 'user_email', 'provider_reference', 'failure_reason'],
            rows.map((row) => [iso(row.createdAt), row.id, row.kind, row.provider, row.status, num(row.amount).toFixed(2), row.currency, row.bookingId ?? '', row.customerId, name(row.customer), row.customer.email, row.providerReference ?? '', row.failureReason ?? '']),
          ),
        };
      }
      case 'invoices': {
        const rows = await this.prisma.invoice.findMany({
          where: period ? { issuedAt: period } : {},
          include: { billedTo: { select: { email: true, firstName: true, lastName: true } } },
          orderBy: { issuedAt: 'asc' },
          take: MAX_EXPORT_ROWS,
        });
        return {
          filename,
          csv: toCsv(
            ['issued_at', 'invoice_number', 'type', 'status', 'booking_id', 'billed_to_id', 'billed_to_name', 'billed_to_email', 'currency', 'subtotal', 'platform_fee', 'tax', 'discount', 'total', 'payment_method'],
            rows.map((row) => [iso(row.issuedAt), row.number, row.type, row.status, row.bookingId ?? '', row.billedToId, name(row.billedTo), row.billedTo.email, row.currency, num(row.subtotal).toFixed(2), num(row.platformFee).toFixed(2), num(row.taxAmount).toFixed(2), num(row.discountAmount).toFixed(2), num(row.total).toFixed(2), row.paymentMethod ?? '']),
          ),
        };
      }
      case 'platform-fees': {
        const rows = await this.prisma.booking.findMany({
          where: {
            OR: [
              { status: 'completed', paymentStatus: { in: ['paid', 'cash_confirmed', 'partially_refunded'] }, ...(period ? { taskCompletedAt: period } : {}) },
              { status: 'cancelled', cancellationFeeAmount: { gt: 0 }, ...(period ? { cancelledAt: period } : {}) },
            ],
          },
          include: {
            customer: { select: { firstName: true, lastName: true } },
            tasker: { select: { firstName: true, lastName: true } },
            service: { select: { name: true } },
          },
          orderBy: { id: 'asc' },
          take: MAX_EXPORT_ROWS,
        });
        return {
          filename,
          csv: toCsv(
            ['booking_id', 'status', 'date', 'service', 'customer', 'tasker', 'payment_source', 'currency', 'total_charged', 'service_amount', 'commission_rate_percent', 'platform_fee', 'late_cancellation_fee', 'tax', 'tip', 'platform_revenue'],
            rows.map((row) => {
              const fee = row.status === 'completed' ? num(row.platformFeeAmount) : 0;
              const cancel = num(row.cancellationFeeAmount);
              return [row.id, row.status, iso(row.taskCompletedAt ?? row.cancelledAt), row.service.name ?? '', name(row.customer), name(row.tasker), row.paymentSource ?? '', row.paymentCurrency, num(row.totalChargedAmount).toFixed(2), num(row.serviceAmount).toFixed(2), num(row.commissionRatePercent), fee.toFixed(2), cancel.toFixed(2), num(row.taxAmount).toFixed(2), num(row.tipAmount).toFixed(2), r2(fee + cancel).toFixed(2)];
            }),
          ),
        };
      }
      case 'tasker-earnings': {
        const rows = await this.prisma.taskerEarning.findMany({
          where: period ? { createdAt: period } : {},
          include: { tasker: { select: { firstName: true, lastName: true, email: true } } },
          orderBy: { createdAt: 'asc' },
          take: MAX_EXPORT_ROWS,
        });
        return {
          filename,
          csv: toCsv(
            ['created_at', 'booking_id', 'tasker_id', 'tasker_name', 'tasker_email', 'status', 'currency', 'gross_customer_amount', 'service_amount', 'platform_commission', 'tax', 'tip', 'tasker_net', 'reversed', 'debt_offset', 'released_to_available'],
            rows.map((row) => [iso(row.createdAt), row.bookingId, row.taskerId, name(row.tasker), row.tasker.email, row.status, row.currency, num(row.grossCustomerAmount).toFixed(2), num(row.serviceAmount).toFixed(2), num(row.platformCommissionAmount).toFixed(2), num(row.taxAmount).toFixed(2), num(row.tipAmount).toFixed(2), num(row.taskerNetAmount).toFixed(2), num(row.reversedAmount).toFixed(2), num(row.debtOffsetAmount).toFixed(2), num(row.releasedToAvailableAmount).toFixed(2)]),
          ),
        };
      }
      case 'tasker-payouts': {
        const rows = await this.prisma.taskerWithdrawal.findMany({
          where: period ? { requestedAt: period } : {},
          include: { tasker: { select: { firstName: true, lastName: true, email: true } }, payoutMethod: { select: { type: true, label: true, maskedIdentifier: true } } },
          orderBy: { requestedAt: 'asc' },
          take: MAX_EXPORT_ROWS,
        });
        return {
          filename,
          csv: toCsv(
            ['requested_at', 'payout_id', 'tasker_id', 'tasker_name', 'tasker_email', 'status', 'amount', 'currency', 'method', 'destination_masked', 'bank_reference', 'processed_at', 'failure_reason'],
            rows.map((row) => [iso(row.requestedAt), row.id, row.taskerId, name(row.tasker), row.tasker.email, row.status, num(row.amount).toFixed(2), row.currency, row.payoutMethod.type, row.payoutMethod.maskedIdentifier, row.providerReference ?? '', iso(row.processedAt), row.failureReason ?? '']),
          ),
        };
      }
      case 'customer-withdrawals': {
        const rows = await this.prisma.customerWithdrawal.findMany({
          where: period ? { requestedAt: period } : {},
          include: { customer: { select: { firstName: true, lastName: true, email: true } } },
          orderBy: { requestedAt: 'asc' },
          take: MAX_EXPORT_ROWS,
        });
        return {
          filename,
          csv: toCsv(
            ['requested_at', 'withdrawal_id', 'customer_id', 'customer_name', 'customer_email', 'status', 'amount', 'currency', 'account_holder', 'destination_masked', 'bank_reference', 'processed_at', 'failure_reason'],
            rows.map((row) => [iso(row.requestedAt), row.id, row.customerId, name(row.customer), row.customer.email, row.status, num(row.amount).toFixed(2), row.currency, row.destinationHolder ?? '', row.destinationMasked ?? '', row.providerReference ?? '', iso(row.processedAt), row.failureReason ?? '']),
          ),
        };
      }
      case 'tasker-deposits': {
        const rows = await this.prisma.taskerDeposit.findMany({
          where: period ? { createdAt: period } : {},
          include: { tasker: { select: { firstName: true, lastName: true, email: true } } },
          orderBy: { createdAt: 'asc' },
          take: MAX_EXPORT_ROWS,
        });
        return {
          filename,
          csv: toCsv(
            ['created_at', 'deposit_id', 'tasker_id', 'tasker_name', 'tasker_email', 'status', 'amount', 'currency', 'payment_method', 'reference', 'paid_at', 'waived_at', 'refunded_at'],
            rows.map((row) => [iso(row.createdAt), row.id, row.taskerId, name(row.tasker), row.tasker.email, row.status, num(row.amount).toFixed(2), row.currency, row.paymentMethod ?? '', row.providerReference ?? '', iso(row.paidAt), iso(row.waivedAt), iso(row.refundedAt)]),
          ),
        };
      }
      default:
        throw new BadRequestException('Unknown dataset');
    }
  }
}
