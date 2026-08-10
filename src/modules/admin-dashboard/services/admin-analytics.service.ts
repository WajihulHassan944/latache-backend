import { Injectable } from '@nestjs/common';
import { Prisma, type User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { UserRole } from '../../../common/enums/user-role.enum';
import { PAYMENT_STATUS } from '../../payments/payments.constants';
import type { AdminActivityQueryDto, AdminDateRangeQueryDto } from '../dto';
import {
  dateFilter,
  fullName,
  money,
  pagination,
  percentage,
  resolveAdminDateRange,
  type ResolvedAdminDateRange,
} from '../admin-dashboard.utils';

interface NumericRow {
  value: number | string | Prisma.Decimal | null;
}

interface RevenueSeriesRow {
  bucket: Date;
  grossRevenue: number | string | Prisma.Decimal;
  platformFees: number | string | Prisma.Decimal;
  taskerEarnings: number | string | Prisma.Decimal;
  tips: number | string | Prisma.Decimal;
  donations: number | string | Prisma.Decimal;
}

interface CountSeriesRow {
  bucket: Date;
  count: number | bigint;
}

interface ServiceAnalyticsRow {
  serviceId: number;
  name: string | null;
  slug: string | null;
  bookings: number | bigint;
  revenue: number | string | Prisma.Decimal;
  platformFees: number | string | Prisma.Decimal;
}

interface CompletionSeriesRow {
  bucket: Date;
  completed: number | bigint;
  cancelled: number | bigint;
  averageRating: number | string | Prisma.Decimal | null;
}

interface DisputeCategoryRow {
  category: string;
  count: number | bigint;
}

interface TopTaskerEarningsRow {
  taskerId: number;
  earnings: number | string | Prisma.Decimal;
}

@Injectable()
export class AdminAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(query: AdminDateRangeQueryDto) {
    const range = resolveAdminDateRange(query);
    const paidAt = dateFilter(range);
    const createdAt = dateFilter(range);
    const activeBookingStatuses = ['pending', 'confirmed', 'en_route', 'arrived', 'in_progress'];

    const [
      revenue,
      totalCustomers,
      totalTaskers,
      activeBookings,
      completedTasks,
      pendingVerifications,
      eliteTaskers,
      bookingStatusRows,
      recentBookings,
      revenueSeries,
    ] = await Promise.all([
      this.prisma.booking.aggregate({
        where: { paymentStatus: PAYMENT_STATUS.Paid, ...(paidAt ? { paidAt } : {}) },
        _sum: { totalChargedAmount: true, platformFeeAmount: true },
      }),
      this.prisma.user.count({ where: { role: UserRole.Customer, deletedAt: null } }),
      this.prisma.user.count({ where: { role: UserRole.Tasker, deletedAt: null } }),
      this.prisma.booking.count({ where: { status: { in: activeBookingStatuses } } }),
      this.prisma.booking.count({ where: { status: 'completed', ...(createdAt ? { taskCompletedAt: createdAt } : {}) } }),
      this.prisma.user.count({
        where: {
          role: UserRole.Tasker,
          deletedAt: null,
          isVerified: true,
          accountStatus: 'pending_approval',
          onboardingStatus: { in: ['submitted', 'pending_review'] },
        },
      }),
      this.prisma.user.count({ where: { role: UserRole.Tasker, deletedAt: null, isElite: true, accountStatus: 'active' } }),
      this.prisma.booking.groupBy({
        by: ['status'],
        where: createdAt ? { createdAt } : undefined,
        _count: { _all: true },
      }),
      this.prisma.booking.findMany({
        where: createdAt ? { createdAt } : undefined,
        select: {
          id: true,
          status: true,
          bookingDate: true,
          startTime: true,
          paymentStatus: true,
          totalChargedAmount: true,
          paymentCurrency: true,
          createdAt: true,
          customer: { select: { id: true, firstName: true, lastName: true } },
          tasker: { select: { id: true, firstName: true, lastName: true } },
          service: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.revenueSeries(range),
    ]);

    return {
      range: this.rangeView(range),
      metrics: {
        grossRevenue: money(revenue._sum.totalChargedAmount),
        platformFees: money(revenue._sum.platformFeeAmount),
        totalCustomers,
        totalTaskers,
        activeBookings,
        completedTasks,
        pendingVerifications,
        eliteTaskers,
      },
      revenueTrend: revenueSeries,
      bookingStatus: bookingStatusRows.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
      recentBookings: recentBookings.map((booking) => ({
        id: String(booking.id),
        status: booking.status,
        bookingDate: booking.bookingDate.toISOString().slice(0, 10),
        startTime: booking.startTime,
        paymentStatus: booking.paymentStatus,
        amount: booking.totalChargedAmount === null ? null : money(booking.totalChargedAmount),
        currency: booking.paymentCurrency,
        customer: { id: String(booking.customer.id), name: fullName(booking.customer.firstName, booking.customer.lastName) },
        tasker: { id: String(booking.tasker.id), name: fullName(booking.tasker.firstName, booking.tasker.lastName) },
        service: booking.service,
        createdAt: booking.createdAt.toISOString(),
      })),
    };
  }

  async revenue(query: AdminDateRangeQueryDto) {
    const range = resolveAdminDateRange(query);
    const paidAt = dateFilter(range);
    const where = { paymentStatus: PAYMENT_STATUS.Paid, ...(paidAt ? { paidAt } : {}) };

    const [aggregate, paidCount, series, byService] = await Promise.all([
      this.prisma.booking.aggregate({
        where,
        _sum: {
          totalChargedAmount: true,
          platformFeeAmount: true,
          serviceAmount: true,
          tipAmount: true,
          donationAmount: true,
        },
        _avg: { totalChargedAmount: true },
      }),
      this.prisma.booking.count({ where }),
      this.revenueSeries(range),
      this.revenueByService(range),
    ]);

    return {
      range: this.rangeView(range),
      metrics: {
        grossRevenue: money(aggregate._sum.totalChargedAmount),
        platformFees: money(aggregate._sum.platformFeeAmount),
        serviceRevenue: money(aggregate._sum.serviceAmount),
        taskerEarnings: money(Number(aggregate._sum.serviceAmount ?? 0) + Number(aggregate._sum.tipAmount ?? 0)),
        tips: money(aggregate._sum.tipAmount),
        donations: money(aggregate._sum.donationAmount),
        averageBookingValue: money(aggregate._avg.totalChargedAmount),
        paidBookings: paidCount,
      },
      series,
      byService,
    };
  }

  async users(query: AdminDateRangeQueryDto) {
    const range = resolveAdminDateRange(query);
    const periodCreated = dateFilter(range);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const [totalCustomers, activeThisMonth, newThisMonth, newInPeriod, statusRows, growth] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.Customer, deletedAt: null } }),
      this.prisma.user.count({
        where: { role: UserRole.Customer, deletedAt: null, lastLoginAt: { gte: monthStart } },
      }),
      this.prisma.user.count({
        where: { role: UserRole.Customer, deletedAt: null, createdAt: { gte: monthStart } },
      }),
      this.prisma.user.count({
        where: { role: UserRole.Customer, deletedAt: null, ...(periodCreated ? { createdAt: periodCreated } : {}) },
      }),
      this.prisma.user.groupBy({
        by: ['accountStatus'],
        where: { role: UserRole.Customer, deletedAt: null },
        _count: { _all: true },
      }),
      this.customerGrowth(range),
    ]);

    let retentionRate = 0;
    if (range.from && range.toExclusive) {
      const priorCustomers = await this.prisma.user.count({
        where: { role: UserRole.Customer, deletedAt: null, createdAt: { lt: range.from } },
      });
      const returningCustomers = await this.prisma.user.count({
        where: {
          role: UserRole.Customer,
          deletedAt: null,
          createdAt: { lt: range.from },
          lastLoginAt: { gte: range.from, lt: range.toExclusive },
        },
      });
      retentionRate = percentage(returningCustomers, priorCustomers);
    } else {
      const active = statusRows.find((row) => row.accountStatus === 'active')?._count._all ?? 0;
      retentionRate = percentage(active, totalCustomers);
    }

    return {
      range: this.rangeView(range),
      metrics: {
        totalCustomers,
        activeThisMonth,
        newThisMonth,
        newInPeriod,
        retentionRate,
      },
      statusBreakdown: statusRows.map((row) => ({ status: row.accountStatus, count: row._count._all })),
      growth,
      retentionDefinition:
        range.from && range.toExclusive
          ? 'Customers created before the selected period who logged in during the period, divided by customers created before the period.'
          : 'Active customer accounts divided by all non-deleted customer accounts.',
    };
  }

  async taskers(query: AdminDateRangeQueryDto) {
    const range = resolveAdminDateRange(query);
    const createdAt = dateFilter(range);
    const bookingDate = dateFilter(range);

    const [totalTaskers, pendingVerification, rating, bookingStatus, growth, responseRows] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.Tasker, deletedAt: null } }),
      this.prisma.user.count({
        where: {
          role: UserRole.Tasker,
          deletedAt: null,
          isVerified: true,
          accountStatus: 'pending_approval',
          onboardingStatus: { in: ['submitted', 'pending_review'] },
        },
      }),
      this.prisma.user.aggregate({
        where: { role: UserRole.Tasker, deletedAt: null, accountStatus: 'active' },
        _avg: { rating: true },
      }),
      this.prisma.booking.groupBy({
        by: ['status'],
        where: bookingDate ? { createdAt: bookingDate } : undefined,
        _count: { _all: true },
      }),
      this.taskerGrowth(range),
      this.averageTaskerResponseMinutes(range),
    ]);

    const completed = bookingStatus.find((row) => row.status === 'completed')?._count._all ?? 0;
    const cancelled = bookingStatus.find((row) => row.status === 'cancelled')?._count._all ?? 0;

    return {
      range: this.rangeView(range),
      metrics: {
        totalTaskers,
        pendingVerification,
        averageRating: Number(Number(rating._avg.rating ?? 0).toFixed(2)),
        completionRate: percentage(completed, completed + cancelled),
        averageConfirmationMinutes: responseRows,
      },
      growth,
    };
  }

  async eliteTaskers(query: AdminDateRangeQueryDto) {
    const range = resolveAdminDateRange(query);
    const createdAt = dateFilter(range);

    const [totalElite, activeElite, inactiveElite, activeInPeriod, topEarnings] = await Promise.all([
      this.prisma.user.count({ where: { role: UserRole.Tasker, deletedAt: null, isElite: true } }),
      this.prisma.user.count({ where: { role: UserRole.Tasker, deletedAt: null, isElite: true, accountStatus: 'active' } }),
      this.prisma.user.count({ where: { role: UserRole.Tasker, deletedAt: null, isElite: true, accountStatus: { in: ['suspended', 'deactivated'] } } }),
      this.prisma.booking.findMany({
        where: {
          status: 'completed',
          tasker: { isElite: true, deletedAt: null },
          ...(createdAt ? { taskCompletedAt: createdAt } : {}),
        },
        select: { taskerId: true },
        distinct: ['taskerId'],
      }),
      this.topTaskerEarnings(range, true),
    ]);

    const taskerIds = topEarnings.map((row) => row.taskerId);
    const taskers = taskerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: taskerIds } },
          select: { id: true, firstName: true, lastName: true, rating: true, completedTasks: true, profilePicture: true },
        })
      : [];
    const byId = new Map(taskers.map((tasker) => [tasker.id, tasker]));

    return {
      range: this.rangeView(range),
      metrics: {
        totalElite,
        activeElite,
        inactiveElite,
        eliteWithCompletedTaskInPeriod: activeInPeriod.length,
      },
      topPerformers: topEarnings.map((row) => {
        const tasker = byId.get(row.taskerId);
        return {
          taskerId: String(row.taskerId),
          name: fullName(tasker?.firstName, tasker?.lastName),
          profilePicture: tasker?.profilePicture ?? '',
          rating: Number(tasker?.rating ?? 0),
          completedTasks: tasker?.completedTasks ?? 0,
          settledEarnings: money(row.earnings),
        };
      }),
    };
  }

  async bookings(query: AdminDateRangeQueryDto) {
    const range = resolveAdminDateRange(query);
    const createdAt = dateFilter(range);
    const where = createdAt ? { createdAt } : undefined;

    const [total, active, statusRows, paidAggregate, services] = await Promise.all([
      this.prisma.booking.count({ where }),
      this.prisma.booking.count({
        where: { ...(where ?? {}), status: { in: ['pending', 'confirmed', 'en_route', 'arrived', 'in_progress'] } },
      }),
      this.prisma.booking.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.booking.aggregate({
        where: { ...(where ?? {}), paymentStatus: PAYMENT_STATUS.Paid },
        _avg: { totalChargedAmount: true },
      }),
      this.bookingServiceAnalytics(range),
    ]);
    const completed = statusRows.find((row) => row.status === 'completed')?._count._all ?? 0;
    const cancelled = statusRows.find((row) => row.status === 'cancelled')?._count._all ?? 0;

    return {
      range: this.rangeView(range),
      metrics: {
        totalBookings: total,
        activeBookings: active,
        completionRate: percentage(completed, completed + cancelled),
        averageBookingValue: money(paidAggregate._avg.totalChargedAmount),
      },
      statusBreakdown: statusRows.map((row) => ({ status: row.status, count: row._count._all })),
      topServices: services,
    };
  }

  async performance(query: AdminDateRangeQueryDto) {
    const range = resolveAdminDateRange(query);
    const bookingDate = dateFilter(range);
    const [statusRows, avgRating, activeDisputes, disputesByCategory, trend, responseMinutes] = await Promise.all([
      this.prisma.booking.groupBy({ by: ['status'], where: bookingDate ? { createdAt: bookingDate } : undefined, _count: { _all: true } }),
      this.prisma.user.aggregate({ where: { role: UserRole.Tasker, deletedAt: null, accountStatus: 'active' }, _avg: { rating: true } }),
      this.prisma.taskComplaint.count({ where: { status: { notIn: ['resolved', 'closed'] }, ...(bookingDate ? { createdAt: bookingDate } : {}) } }),
      this.disputesByCategory(range),
      this.completionAndRatingTrend(range),
      this.averageTaskerResponseMinutes(range),
    ]);
    const completed = statusRows.find((row) => row.status === 'completed')?._count._all ?? 0;
    const cancelled = statusRows.find((row) => row.status === 'cancelled')?._count._all ?? 0;

    return {
      range: this.rangeView(range),
      metrics: {
        completionRate: percentage(completed, completed + cancelled),
        averageRating: Number(Number(avgRating._avg.rating ?? 0).toFixed(2)),
        averageConfirmationMinutes: responseMinutes,
        activeDisputes,
      },
      trend,
      disputesByCategory,
    };
  }

  async taskerEarnings(query: AdminDateRangeQueryDto) {
    const range = resolveAdminDateRange(query);
    const ledgerCreatedAt = dateFilter(range);
    const withdrawalCreatedAt = dateFilter(range);
    const paidAt = dateFilter(range);

    const [earnings, payouts, platform, paidWithdrawalAverage, series, topEarners] = await Promise.all([
      this.prisma.taskerWalletLedgerEntry.aggregate({
        where: { kind: 'earning', status: 'settled', ...(ledgerCreatedAt ? { createdAt: ledgerCreatedAt } : {}) },
        _sum: { amount: true },
      }),
      this.prisma.taskerWithdrawal.aggregate({
        where: { status: 'paid', ...(withdrawalCreatedAt ? { processedAt: withdrawalCreatedAt } : {}) },
        _sum: { amount: true },
      }),
      this.prisma.booking.aggregate({
        where: { paymentStatus: PAYMENT_STATUS.Paid, ...(paidAt ? { paidAt } : {}) },
        _sum: { platformFeeAmount: true },
      }),
      this.prisma.taskerWithdrawal.aggregate({
        where: { status: 'paid', ...(withdrawalCreatedAt ? { processedAt: withdrawalCreatedAt } : {}) },
        _avg: { amount: true },
      }),
      this.earningsSeries(range),
      this.topTaskerEarnings(range, false),
    ]);

    const ids = topEarners.map((row) => row.taskerId);
    const taskers = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, firstName: true, lastName: true, rating: true, profilePicture: true },
        })
      : [];
    const byId = new Map(taskers.map((tasker) => [tasker.id, tasker]));

    return {
      range: this.rangeView(range),
      metrics: {
        settledTaskerEarnings: money(earnings._sum.amount),
        paidWithdrawals: money(payouts._sum.amount),
        platformRevenue: money(platform._sum.platformFeeAmount),
        averagePaidWithdrawal: money(paidWithdrawalAverage._avg.amount),
      },
      series,
      topEarners: topEarners.map((row) => {
        const tasker = byId.get(row.taskerId);
        return {
          taskerId: String(row.taskerId),
          name: fullName(tasker?.firstName, tasker?.lastName),
          profilePicture: tasker?.profilePicture ?? '',
          rating: Number(tasker?.rating ?? 0),
          settledEarnings: money(row.earnings),
        };
      }),
    };
  }

  async activity(query: AdminActivityQueryDto) {
    const { page, limit } = pagination(query.page, query.limit);
    const take = Math.min(500, page * limit);
    const categories = query.category ?? 'all';

    const includeUsers = categories === 'all' || categories === 'users';
    const includeBookings = categories === 'all' || categories === 'bookings';
    const includePayments = categories === 'all' || categories === 'payments';
    const includeAdmin = categories === 'all' || categories === 'admin';

    const [users, bookings, payments, withdrawals, audits, userCount, bookingCount, paymentCount, withdrawalCount, auditCount] = await Promise.all([
      includeUsers
        ? this.prisma.user.findMany({
            where: { deletedAt: null },
            select: { id: true, role: true, firstName: true, lastName: true, createdAt: true, onboardingStatus: true },
            orderBy: { createdAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
      includeBookings
        ? this.prisma.booking.findMany({
            select: {
              id: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              customer: { select: { id: true, firstName: true, lastName: true } },
              tasker: { select: { id: true, firstName: true, lastName: true } },
              service: { select: { name: true } },
            },
            orderBy: { updatedAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
      includePayments
        ? this.prisma.paymentTransaction.findMany({
            select: { id: true, customerId: true, bookingId: true, kind: true, status: true, amount: true, currency: true, createdAt: true, updatedAt: true },
            orderBy: { updatedAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
      includePayments
        ? this.prisma.taskerWithdrawal.findMany({
            select: { id: true, taskerId: true, amount: true, currency: true, status: true, requestedAt: true, processedAt: true },
            orderBy: { requestedAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
      includeAdmin
        ? this.prisma.adminAuditLog.findMany({
            include: {
              actor: { select: { id: true, firstName: true, lastName: true, email: true } },
              targetUser: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
            },
            orderBy: { createdAt: 'desc' },
            take,
          })
        : Promise.resolve([]),
      includeUsers ? this.prisma.user.count({ where: { deletedAt: null } }) : Promise.resolve(0),
      includeBookings ? this.prisma.booking.count() : Promise.resolve(0),
      includePayments ? this.prisma.paymentTransaction.count() : Promise.resolve(0),
      includePayments ? this.prisma.taskerWithdrawal.count() : Promise.resolve(0),
      includeAdmin ? this.prisma.adminAuditLog.count() : Promise.resolve(0),
    ]);

    const items: Array<Record<string, unknown> & { occurredAt: string }> = [];
    for (const user of users) {
      items.push({
        id: `user:${user.id}:${user.createdAt.getTime()}`,
        category: 'users',
        type: user.role === UserRole.Tasker ? 'tasker_registered' : user.role === UserRole.Customer ? 'customer_registered' : 'administrator_created',
        title: `${user.role === UserRole.Tasker ? 'Tasker' : user.role === UserRole.Customer ? 'Customer' : 'Administrator'} account created`,
        actor: { type: 'user', id: String(user.id), name: fullName(user.firstName, user.lastName) },
        entity: { type: 'user', id: String(user.id) },
        metadata: { role: user.role, onboardingStatus: user.onboardingStatus },
        occurredAt: user.createdAt.toISOString(),
      });
    }
    for (const booking of bookings) {
      items.push({
        id: `booking:${booking.id}:${booking.updatedAt.getTime()}`,
        category: 'bookings',
        type: booking.createdAt.getTime() === booking.updatedAt.getTime() ? 'booking_created' : 'booking_updated',
        title: `Booking #${booking.id} is ${booking.status.replaceAll('_', ' ')}`,
        actor: { type: 'customer', id: String(booking.customer.id), name: fullName(booking.customer.firstName, booking.customer.lastName) },
        entity: { type: 'booking', id: String(booking.id) },
        metadata: {
          status: booking.status,
          tasker: { id: String(booking.tasker.id), name: fullName(booking.tasker.firstName, booking.tasker.lastName) },
          service: booking.service.name,
        },
        occurredAt: booking.updatedAt.toISOString(),
      });
    }
    for (const payment of payments) {
      items.push({
        id: `payment:${payment.id}:${payment.updatedAt.getTime()}`,
        category: 'payments',
        type: `payment_${payment.status}`,
        title: `${payment.kind.replaceAll('_', ' ')} ${payment.status}`,
        actor: { type: 'customer', id: String(payment.customerId) },
        entity: { type: 'payment', id: payment.id },
        metadata: { bookingId: payment.bookingId ? String(payment.bookingId) : null, amount: money(payment.amount), currency: payment.currency },
        occurredAt: payment.updatedAt.toISOString(),
      });
    }
    for (const withdrawal of withdrawals) {
      items.push({
        id: `withdrawal:${withdrawal.id}:${withdrawal.requestedAt.getTime()}`,
        category: 'payments',
        type: `withdrawal_${withdrawal.status}`,
        title: `Tasker withdrawal ${withdrawal.status.replaceAll('_', ' ')}`,
        actor: { type: 'tasker', id: String(withdrawal.taskerId) },
        entity: { type: 'withdrawal', id: withdrawal.id },
        metadata: { amount: money(withdrawal.amount), currency: withdrawal.currency },
        occurredAt: (withdrawal.processedAt ?? withdrawal.requestedAt).toISOString(),
      });
    }
    for (const audit of audits) {
      items.push({
        id: `admin:${audit.id}`,
        category: 'admin',
        type: audit.action,
        title: audit.action.replaceAll('_', ' '),
        actor: audit.actor
          ? { type: 'administrator', id: String(audit.actor.id), name: fullName(audit.actor.firstName, audit.actor.lastName), email: audit.actor.email }
          : { type: 'system', id: null },
        entity: { type: audit.entityType, id: audit.entityId },
        target: audit.targetUser
          ? { id: String(audit.targetUser.id), name: fullName(audit.targetUser.firstName, audit.targetUser.lastName), email: audit.targetUser.email, role: audit.targetUser.role }
          : null,
        reason: audit.reason,
        metadata: audit.metadata,
        occurredAt: audit.createdAt.toISOString(),
      });
    }

    items.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
    const start = (page - 1) * limit;
    const totalItems = userCount + bookingCount + paymentCount + withdrawalCount + auditCount;
    return {
      items: items.slice(start, start + limit),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  private rangeView(range: ResolvedAdminDateRange) {
    return {
      range: range.range,
      from: range.from?.toISOString() ?? null,
      toExclusive: range.toExclusive?.toISOString() ?? null,
      granularity: range.granularity,
      timezone: 'UTC',
    };
  }

  private sqlDateCondition(column: Prisma.Sql, range: ResolvedAdminDateRange): Prisma.Sql {
    if (!range.from || !range.toExclusive) return Prisma.sql``;
    return Prisma.sql`AND ${column} >= ${range.from} AND ${column} < ${range.toExclusive}`;
  }

  private bucket(column: Prisma.Sql, range: ResolvedAdminDateRange): Prisma.Sql {
    return range.granularity === 'day'
      ? Prisma.sql`date_trunc('day', ${column})`
      : Prisma.sql`date_trunc('month', ${column})`;
  }

  private async revenueSeries(range: ResolvedAdminDateRange) {
    const bucket = this.bucket(Prisma.sql`b."paidAt"`, range);
    const condition = this.sqlDateCondition(Prisma.sql`b."paidAt"`, range);
    const rows = await this.prisma.$queryRaw<RevenueSeriesRow[]>(Prisma.sql`
      SELECT
        ${bucket} AS bucket,
        COALESCE(SUM(b."totalChargedAmount"), 0) AS "grossRevenue",
        COALESCE(SUM(b."platformFeeAmount"), 0) AS "platformFees",
        COALESCE(SUM(COALESCE(b."serviceAmount", 0) + b."tipAmount"), 0) AS "taskerEarnings",
        COALESCE(SUM(b."tipAmount"), 0) AS tips,
        COALESCE(SUM(b."donationAmount"), 0) AS donations
      FROM "Bookings" b
      WHERE b."paymentStatus" = ${PAYMENT_STATUS.Paid}
        AND b."paidAt" IS NOT NULL
        ${condition}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    return rows.map((row) => ({
      bucket: row.bucket.toISOString(),
      grossRevenue: money(row.grossRevenue),
      platformFees: money(row.platformFees),
      taskerEarnings: money(row.taskerEarnings),
      tips: money(row.tips),
      donations: money(row.donations),
    }));
  }

  private async revenueByService(range: ResolvedAdminDateRange) {
    const condition = this.sqlDateCondition(Prisma.sql`b."paidAt"`, range);
    const rows = await this.prisma.$queryRaw<ServiceAnalyticsRow[]>(Prisma.sql`
      SELECT
        s."id" AS "serviceId",
        s."name",
        s."slug",
        COUNT(*)::int AS bookings,
        COALESCE(SUM(b."totalChargedAmount"), 0) AS revenue,
        COALESCE(SUM(b."platformFeeAmount"), 0) AS "platformFees"
      FROM "Bookings" b
      JOIN "Services" s ON s."id" = b."serviceId"
      WHERE b."paymentStatus" = ${PAYMENT_STATUS.Paid}
        AND b."paidAt" IS NOT NULL
        ${condition}
      GROUP BY s."id", s."name", s."slug"
      ORDER BY revenue DESC
      LIMIT 20
    `);
    return rows.map((row) => ({
      serviceId: String(row.serviceId),
      name: row.name ?? '',
      slug: row.slug ?? '',
      paidBookings: Number(row.bookings),
      revenue: money(row.revenue),
      platformFees: money(row.platformFees),
    }));
  }

  private async customerGrowth(range: ResolvedAdminDateRange) {
    const bucket = this.bucket(Prisma.sql`u."createdAt"`, range);
    const condition = this.sqlDateCondition(Prisma.sql`u."createdAt"`, range);
    const rows = await this.prisma.$queryRaw<CountSeriesRow[]>(Prisma.sql`
      SELECT ${bucket} AS bucket, COUNT(*)::int AS count
      FROM "Users" u
      WHERE u."role" = ${UserRole.Customer} AND u."deletedAt" IS NULL ${condition}
      GROUP BY 1 ORDER BY 1 ASC
    `);
    return rows.map((row) => ({ bucket: row.bucket.toISOString(), count: Number(row.count) }));
  }

  private async taskerGrowth(range: ResolvedAdminDateRange) {
    const bucket = this.bucket(Prisma.sql`u."createdAt"`, range);
    const condition = this.sqlDateCondition(Prisma.sql`u."createdAt"`, range);
    const rows = await this.prisma.$queryRaw<CountSeriesRow[]>(Prisma.sql`
      SELECT ${bucket} AS bucket, COUNT(*)::int AS count
      FROM "Users" u
      WHERE u."role" = ${UserRole.Tasker} AND u."deletedAt" IS NULL ${condition}
      GROUP BY 1 ORDER BY 1 ASC
    `);
    return rows.map((row) => ({ bucket: row.bucket.toISOString(), count: Number(row.count) }));
  }

  private async bookingServiceAnalytics(range: ResolvedAdminDateRange) {
    const condition = this.sqlDateCondition(Prisma.sql`b."createdAt"`, range);
    const rows = await this.prisma.$queryRaw<ServiceAnalyticsRow[]>(Prisma.sql`
      SELECT s."id" AS "serviceId", s."name", s."slug", COUNT(*)::int AS bookings,
             COALESCE(SUM(CASE WHEN b."paymentStatus" = ${PAYMENT_STATUS.Paid} THEN b."totalChargedAmount" ELSE 0 END), 0) AS revenue,
             COALESCE(SUM(CASE WHEN b."paymentStatus" = ${PAYMENT_STATUS.Paid} THEN b."platformFeeAmount" ELSE 0 END), 0) AS "platformFees"
      FROM "Bookings" b
      JOIN "Services" s ON s."id" = b."serviceId"
      WHERE 1 = 1 ${condition}
      GROUP BY s."id", s."name", s."slug"
      ORDER BY bookings DESC
      LIMIT 20
    `);
    return rows.map((row) => ({
      serviceId: String(row.serviceId),
      name: row.name ?? '',
      slug: row.slug ?? '',
      bookings: Number(row.bookings),
      revenue: money(row.revenue),
    }));
  }

  private async averageTaskerResponseMinutes(range: ResolvedAdminDateRange): Promise<number | null> {
    const condition = this.sqlDateCondition(Prisma.sql`b."createdAt"`, range);
    const rows = await this.prisma.$queryRaw<NumericRow[]>(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM (b."confirmedAt" - b."createdAt")) / 60.0) AS value
      FROM "Bookings" b
      WHERE b."confirmedAt" IS NOT NULL AND b."confirmedAt" >= b."createdAt" ${condition}
    `);
    const value = rows[0]?.value;
    return value === null || value === undefined ? null : Number(Number(value).toFixed(1));
  }

  private async disputesByCategory(range: ResolvedAdminDateRange) {
    const condition = this.sqlDateCondition(Prisma.sql`c."createdAt"`, range);
    const rows = await this.prisma.$queryRaw<DisputeCategoryRow[]>(Prisma.sql`
      SELECT c."category", COUNT(*)::int AS count
      FROM "TaskComplaints" c
      WHERE 1 = 1 ${condition}
      GROUP BY c."category"
      ORDER BY count DESC
    `);
    return rows.map((row) => ({ category: row.category, count: Number(row.count) }));
  }

  private async completionAndRatingTrend(range: ResolvedAdminDateRange) {
    const bucket = this.bucket(Prisma.sql`b."createdAt"`, range);
    const condition = this.sqlDateCondition(Prisma.sql`b."createdAt"`, range);
    const rows = await this.prisma.$queryRaw<CompletionSeriesRow[]>(Prisma.sql`
      SELECT
        ${bucket} AS bucket,
        COUNT(*) FILTER (WHERE b."status" = 'completed')::int AS completed,
        COUNT(*) FILTER (WHERE b."status" = 'cancelled')::int AS cancelled,
        AVG(r."rating") AS "averageRating"
      FROM "Bookings" b
      LEFT JOIN "Reviews" r ON r."bookingId" = b."id" AND r."revieweeId" = b."taskerId"
      WHERE 1 = 1 ${condition}
      GROUP BY 1
      ORDER BY 1 ASC
    `);
    return rows.map((row) => ({
      bucket: row.bucket.toISOString(),
      completionRate: percentage(Number(row.completed), Number(row.completed) + Number(row.cancelled)),
      averageRating: row.averageRating === null ? null : Number(Number(row.averageRating).toFixed(2)),
    }));
  }

  private async earningsSeries(range: ResolvedAdminDateRange) {
    const bucket = this.bucket(Prisma.sql`l."createdAt"`, range);
    const condition = this.sqlDateCondition(Prisma.sql`l."createdAt"`, range);
    const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; taskerEarnings: number | string | Prisma.Decimal }>>(Prisma.sql`
      SELECT ${bucket} AS bucket, COALESCE(SUM(l."amount"), 0) AS "taskerEarnings"
      FROM "TaskerWalletLedger" l
      WHERE l."kind" = 'earning' AND l."status" = 'settled' ${condition}
      GROUP BY 1 ORDER BY 1 ASC
    `);
    return rows.map((row) => ({ bucket: row.bucket.toISOString(), taskerEarnings: money(row.taskerEarnings) }));
  }

  private async topTaskerEarnings(range: ResolvedAdminDateRange, eliteOnly: boolean): Promise<TopTaskerEarningsRow[]> {
    const condition = this.sqlDateCondition(Prisma.sql`l."createdAt"`, range);
    const elite = eliteOnly ? Prisma.sql`AND u."isElite" = TRUE` : Prisma.sql``;
    return this.prisma.$queryRaw<TopTaskerEarningsRow[]>(Prisma.sql`
      SELECT l."taskerId", COALESCE(SUM(l."amount"), 0) AS earnings
      FROM "TaskerWalletLedger" l
      JOIN "Users" u ON u."id" = l."taskerId"
      WHERE l."kind" = 'earning' AND l."status" = 'settled' AND u."deletedAt" IS NULL ${elite} ${condition}
      GROUP BY l."taskerId"
      ORDER BY earnings DESC
      LIMIT 10
    `);
  }
}
