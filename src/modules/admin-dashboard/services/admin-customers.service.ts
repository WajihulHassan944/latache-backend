import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { AuthSessionsRepository } from '../../auth/repositories/auth-sessions.repository';
import { NotificationsService } from '../../notifications/notifications.service';
import type {
  AdminCustomerBookingsQueryDto,
  AdminCustomerPaymentsQueryDto,
  AdminDateRangeQueryDto,
  AdminUserModerationDto,
  ListAdminCustomersDto,
} from '../dto';
import {
  dateFilter,
  fullName,
  money,
  pagination,
  percentage,
  resolveAdminDateRange,
} from '../admin-dashboard.utils';
import { AccountDeletionService } from '../../account-deletion/account-deletion.service';

const ACTIVE_DISPUTE_STATUSES = ['open', 'under_investigation', 'escalated'] as const;

@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly accountDeletion: AccountDeletionService,
  ) {}

  permanentlyDelete(actor: User, customerId: number, reason: string) {
    return this.accountDeletion.permanentlyDelete(actor, customerId, UserRole.Customer, reason);
  }

  async list(query: ListAdminCustomersDto) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      roles: { has: UserRole.Customer },
      deletedAt: null,
      customerProfile: { isNot: null },
      ...(query.status === 'pending_verification'
        ? { accountStatus: AccountStatus.PendingVerification }
        : query.status
          ? { customerProfile: { is: { status: query.status } } }
          : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phoneNumber: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.UserOrderByWithRelationInput[] =
      query.sort === 'oldest'
        ? [{ createdAt: 'asc' }]
        : query.sort === 'rating_desc'
          ? [{ customerProfile: { rating: 'desc' } }, { createdAt: 'desc' }]
          : query.sort === 'bookings_desc'
            ? [{ bookingsAsCustomer: { _count: 'desc' } }, { createdAt: 'desc' }]
            : [{ createdAt: 'desc' }];

    const [customers, totalItems] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phoneCountryCode: true,
          phoneNumber: true,
          zipCode: true,
          profilePicture: true,
          accountStatus: true,
          customerProfile: { select: { status: true, rating: true, reviewsCount: true } },
          rating: true,
          reviewsCount: true,
          lastLoginAt: true,
          createdAt: true,
          _count: { select: { bookingsAsCustomer: true } },
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    const ids = customers.map((customer) => customer.id);
    const spendRows = ids.length
      ? await this.prisma.paymentTransaction.groupBy({
          by: ['customerId'],
          where: { customerId: { in: ids }, kind: 'booking_charge', status: 'succeeded' },
          _sum: { amount: true },
        })
      : [];
    const spendByCustomer = new Map(
      spendRows.map((row) => [row.customerId, money(row._sum.amount)]),
    );

    return {
      items: customers.map((customer) => ({
        id: String(customer.id),
        customerId: `CUS-${String(customer.id).padStart(5, '0')}`,
        name: fullName(customer.firstName, customer.lastName),
        email: customer.email,
        phone: `${customer.phoneCountryCode ?? ''}${customer.phoneNumber ?? ''}`,
        zipCode: customer.zipCode ?? '',
        profilePicture: customer.profilePicture ?? '',
        accountStatus: customer.accountStatus === AccountStatus.PendingVerification ? customer.accountStatus : (customer.customerProfile?.status ?? customer.accountStatus),
        bookingsCount: customer._count.bookingsAsCustomer,
        totalSpent: spendByCustomer.get(customer.id) ?? 0,
        rating: Number(customer.customerProfile?.rating ?? customer.rating),
        reviewsCount: customer.customerProfile?.reviewsCount ?? customer.reviewsCount,
        lastLoginAt: customer.lastLoginAt?.toISOString() ?? null,
        joinedAt: customer.createdAt.toISOString(),
      })),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  async allBookings(query: AdminCustomerBookingsQueryDto) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const search = query.search?.trim();
    const numericId = search && /^\d+$/.test(search) ? Number(search) : null;
    const where: Prisma.BookingWhereInput = {
      ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              ...(numericId ? [{ id: numericId }] : []),
              { customer: { firstName: { contains: search, mode: 'insensitive' } } },
              { customer: { lastName: { contains: search, mode: 'insensitive' } } },
              { customer: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        select: {
          id: true,
          status: true,
          bookingDate: true,
          startTime: true,
          endTime: true,
          paymentStatus: true,
          totalChargedAmount: true,
          paymentCurrency: true,
          createdAt: true,
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
          tasker: { select: { id: true, firstName: true, lastName: true } },
          service: { select: { id: true, name: true, slug: true } },
        },
        orderBy: [{ bookingDate: 'desc' }, { startTime: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return {
      items: rows.map((booking) => ({
        id: String(booking.id),
        bookingId: `BKG-${String(booking.id).padStart(5, '0')}`,
        status: booking.status,
        date: booking.bookingDate.toISOString().slice(0, 10),
        startTime: booking.startTime,
        endTime: booking.endTime,
        paymentStatus: booking.paymentStatus,
        amount: booking.totalChargedAmount === null ? null : money(booking.totalChargedAmount),
        currency: booking.paymentCurrency,
        customer: {
          id: String(booking.customer.id),
          name: fullName(booking.customer.firstName, booking.customer.lastName),
          email: booking.customer.email,
        },
        tasker: {
          id: String(booking.tasker.id),
          name: fullName(booking.tasker.firstName, booking.tasker.lastName),
        },
        service: booking.service,
        createdAt: booking.createdAt.toISOString(),
      })),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  async allPayments(query: AdminCustomerPaymentsQueryDto) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const search = query.search?.trim();
    const where: Prisma.PaymentTransactionWhereInput = {
      ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
      ...(query.kind && query.kind !== 'all' ? { kind: query.kind } : {}),
      ...(search
        ? {
            OR: [
              { providerReference: { contains: search, mode: 'insensitive' } },
              { customer: { firstName: { contains: search, mode: 'insensitive' } } },
              { customer: { lastName: { contains: search, mode: 'insensitive' } } },
              { customer: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [rows, totalItems, collected, bookingValue, refunded, disputed] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where,
        include: {
          customer: { select: { id: true, firstName: true, lastName: true, email: true } },
          booking: {
            select: { id: true, service: { select: { id: true, name: true, slug: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.paymentTransaction.count({ where }),
      this.prisma.paymentTransaction.aggregate({
        where: {
          status: 'succeeded',
          OR: [
            { kind: 'wallet_topup' },
            { kind: 'booking_charge', provider: { not: 'internal_wallet' } },
          ],
        },
        _sum: { amount: true },
      }),
      this.prisma.paymentTransaction.aggregate({
        where: { status: 'succeeded', kind: 'booking_charge' },
        _sum: { amount: true },
      }),
      this.prisma.paymentTransaction.aggregate({
        where: { status: 'succeeded', kind: 'refund' },
        _sum: { amount: true },
      }),
      this.prisma.booking.aggregate({
        where: {
          complaints: { some: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } },
        },
        _sum: { totalChargedAmount: true },
        _count: { _all: true },
      }),
    ]);
    return {
      summary: {
        totalCollected: money(collected._sum.amount),
        successfulBookingValue: money(bookingValue._sum.amount),
        totalRefunded: money(refunded._sum.amount),
        disputedAmount: money(disputed._sum.totalChargedAmount),
        disputedBookings: disputed._count._all,
        transactions: totalItems,
      },
      items: rows.map((payment) => ({
        id: payment.id,
        bookingId: payment.bookingId ? String(payment.bookingId) : null,
        kind: payment.kind,
        provider: payment.provider,
        providerReference: payment.providerReference,
        status: payment.status,
        amount: money(payment.amount),
        currency: payment.currency,
        failureReason: payment.failureReason,
        customer: {
          id: String(payment.customer.id),
          name: fullName(payment.customer.firstName, payment.customer.lastName),
          email: payment.customer.email,
        },
        service: payment.booking?.service ?? null,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
      })),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  async details(customerId: number) {
    const customer = await this.requireCustomer(customerId);
    const [bookingCounts, spend, recentBookings, recentPayments, reviewsReceived] =
      await Promise.all([
        this.prisma.booking.groupBy({
          by: ['status'],
          where: { customerId },
          _count: { _all: true },
        }),
        this.prisma.paymentTransaction.aggregate({
          where: { customerId, kind: 'booking_charge', status: 'succeeded' },
          _sum: { amount: true },
        }),
        this.prisma.booking.findMany({
          where: { customerId },
          select: {
            id: true,
            status: true,
            bookingDate: true,
            startTime: true,
            totalChargedAmount: true,
            paymentCurrency: true,
            service: { select: { id: true, name: true, slug: true } },
            tasker: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: [{ bookingDate: 'desc' }, { startTime: 'desc' }],
          take: 5,
        }),
        this.prisma.paymentTransaction.findMany({
          where: { customerId },
          select: {
            id: true,
            kind: true,
            status: true,
            amount: true,
            currency: true,
            bookingId: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.prisma.review.aggregate({
          where: { revieweeId: customerId, revieweeRole: UserRole.Customer, moderationStatus: 'visible' },
          _avg: { rating: true },
          _count: { _all: true },
        }),
      ]);

    return {
      customer: {
        id: String(customer.id),
        customerId: `CUS-${String(customer.id).padStart(5, '0')}`,
        firstName: customer.firstName ?? '',
        lastName: customer.lastName ?? '',
        name: fullName(customer.firstName, customer.lastName),
        email: customer.email,
        phoneCountryCode: customer.phoneCountryCode ?? '',
        phoneNumber: customer.phoneNumber ?? '',
        zipCode: customer.zipCode ?? '',
        profilePicture: customer.profilePicture ?? '',
        accountStatus:
          customer.accountStatus === AccountStatus.PendingVerification
            ? customer.accountStatus
            : (customer.customerProfile?.status ?? customer.accountStatus),
        isVerified: customer.isVerified,
        lastLoginAt: customer.lastLoginAt?.toISOString() ?? null,
        memberSince: customer.createdAt.toISOString(),
      },
      metrics: {
        totalBookings: bookingCounts.reduce((sum, row) => sum + row._count._all, 0),
        completedBookings:
          bookingCounts.find((row) => row.status === 'completed')?._count._all ?? 0,
        cancelledBookings:
          bookingCounts.find((row) => row.status === 'cancelled')?._count._all ?? 0,
        totalSpent: money(spend._sum.amount),
        averageRatingReceived: Number(Number(reviewsReceived._avg.rating ?? 0).toFixed(2)),
        reviewsReceived: reviewsReceived._count._all,
      },
      recentBookings: recentBookings.map((booking) => ({
        id: String(booking.id),
        status: booking.status,
        date: booking.bookingDate.toISOString().slice(0, 10),
        startTime: booking.startTime,
        amount: booking.totalChargedAmount === null ? null : money(booking.totalChargedAmount),
        currency: booking.paymentCurrency,
        service: booking.service,
        tasker: {
          id: String(booking.tasker.id),
          name: fullName(booking.tasker.firstName, booking.tasker.lastName),
        },
      })),
      recentPayments: recentPayments.map((payment) => ({
        id: payment.id,
        bookingId: payment.bookingId ? String(payment.bookingId) : null,
        kind: payment.kind,
        status: payment.status,
        amount: money(payment.amount),
        currency: payment.currency,
        createdAt: payment.createdAt.toISOString(),
      })),
    };
  }

  async bookings(customerId: number, query: AdminCustomerBookingsQueryDto) {
    await this.requireCustomer(customerId);
    const { page, limit, skip } = pagination(query.page, query.limit);
    const where: Prisma.BookingWhereInput = {
      customerId,
      ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        select: {
          id: true,
          status: true,
          bookingDate: true,
          startTime: true,
          endTime: true,
          venueAddress: true,
          paymentStatus: true,
          totalChargedAmount: true,
          paymentCurrency: true,
          createdAt: true,
          service: { select: { id: true, name: true, slug: true } },
          tasker: { select: { id: true, firstName: true, lastName: true, profilePicture: true } },
        },
        orderBy: [{ bookingDate: 'desc' }, { startTime: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return {
      items: rows.map((booking) => ({
        id: String(booking.id),
        status: booking.status,
        date: booking.bookingDate.toISOString().slice(0, 10),
        startTime: booking.startTime,
        endTime: booking.endTime,
        venueAddress: booking.venueAddress,
        paymentStatus: booking.paymentStatus,
        amount: booking.totalChargedAmount === null ? null : money(booking.totalChargedAmount),
        currency: booking.paymentCurrency,
        service: booking.service,
        tasker: {
          id: String(booking.tasker.id),
          name: fullName(booking.tasker.firstName, booking.tasker.lastName),
          profilePicture: booking.tasker.profilePicture ?? '',
        },
        createdAt: booking.createdAt.toISOString(),
      })),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  async payments(customerId: number, query: AdminCustomerPaymentsQueryDto) {
    await this.requireCustomer(customerId);
    const { page, limit, skip } = pagination(query.page, query.limit);
    const where: Prisma.PaymentTransactionWhereInput = {
      customerId,
      ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
      ...(query.kind && query.kind !== 'all' ? { kind: query.kind } : {}),
    };
    const [rows, totalItems, summary] = await Promise.all([
      this.prisma.paymentTransaction.findMany({
        where,
        include: {
          booking: {
            select: { id: true, service: { select: { id: true, name: true, slug: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.paymentTransaction.count({ where }),
      this.prisma.paymentTransaction.groupBy({
        by: ['status'],
        where: { customerId },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    return {
      summary: summary.map((row) => ({
        status: row.status,
        count: row._count._all,
        amount: money(row._sum.amount),
      })),
      items: rows.map((payment) => ({
        id: payment.id,
        bookingId: payment.bookingId ? String(payment.bookingId) : null,
        kind: payment.kind,
        provider: payment.provider,
        providerReference: payment.providerReference,
        status: payment.status,
        amount: money(payment.amount),
        currency: payment.currency,
        failureReason: payment.failureReason,
        service: payment.booking?.service ?? null,
        createdAt: payment.createdAt.toISOString(),
        updatedAt: payment.updatedAt.toISOString(),
      })),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  async reports(query: AdminDateRangeQueryDto) {
    const range = resolveAdminDateRange(query);
    const period = dateFilter(range);
    const [totalCustomers, statusRows, topSpendRows, createdInPeriod] = await Promise.all([
      this.prisma.user.count({ where: { roles: { has: UserRole.Customer }, deletedAt: null } }),
      Promise.all([
        this.prisma.customerProfile.groupBy({
          by: ['status'],
          where: { user: { deletedAt: null, isVerified: true, roles: { has: UserRole.Customer } } },
          _count: { _all: true },
        }),
        this.prisma.user.count({
          where: {
            roles: { has: UserRole.Customer },
            deletedAt: null,
            isVerified: false,
            accountStatus: AccountStatus.PendingVerification,
          },
        }),
      ]),
      this.prisma.paymentTransaction.groupBy({
        by: ['customerId'],
        where: {
          kind: 'booking_charge',
          status: 'succeeded',
          ...(period ? { createdAt: period } : {}),
        },
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 10,
      }),
      this.prisma.user.count({
        where: {
          roles: { has: UserRole.Customer },
          deletedAt: null,
          ...(period ? { createdAt: period } : {}),
        },
      }),
    ]);

    const [customerProfileStatusRows, pendingVerificationCustomers] = statusRows;
    const effectiveStatusRows = [
      ...customerProfileStatusRows.map((row) => ({ status: row.status, count: row._count._all })),
      ...(pendingVerificationCustomers > 0
        ? [{ status: AccountStatus.PendingVerification, count: pendingVerificationCustomers }]
        : []),
    ];

    let retentionRate = 0;
    if (range.from && range.toExclusive) {
      const [base, retained] = await Promise.all([
        this.prisma.user.count({
          where: { roles: { has: UserRole.Customer }, deletedAt: null, createdAt: { lt: range.from } },
        }),
        this.prisma.user.count({
          where: {
            roles: { has: UserRole.Customer },
            deletedAt: null,
            createdAt: { lt: range.from },
            lastLoginAt: { gte: range.from, lt: range.toExclusive },
          },
        }),
      ]);
      retentionRate = percentage(retained, base);
    }

    const topIds = topSpendRows.map((row) => row.customerId);
    const topCustomers = topIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: topIds } },
          select: { id: true, firstName: true, lastName: true, email: true, profilePicture: true },
        })
      : [];
    const byId = new Map(topCustomers.map((customer) => [customer.id, customer]));
    const deactivated =
      effectiveStatusRows.find((row) => row.status === AccountStatus.Deactivated)?.count ?? 0;

    return {
      range: {
        range: range.range,
        from: range.from?.toISOString() ?? null,
        toExclusive: range.toExclusive?.toISOString() ?? null,
        timezone: 'UTC',
      },
      metrics: {
        totalCustomers,
        createdInPeriod,
        retentionRate,
        churnRate: percentage(deactivated, totalCustomers),
      },
      statusBreakdown: effectiveStatusRows,
      topCustomersBySpend: topSpendRows.map((row) => {
        const customer = byId.get(row.customerId);
        return {
          customerId: String(row.customerId),
          name: fullName(customer?.firstName, customer?.lastName),
          email: customer?.email ?? '',
          profilePicture: customer?.profilePicture ?? '',
          successfulPayments: row._count._all,
          amount: money(row._sum.amount),
        };
      }),
      definitions: {
        retentionRate:
          'Existing customers who logged in during the selected period divided by customers who existed before the period.',
        churnRate:
          'Currently deactivated customer accounts divided by all non-deleted customer accounts.',
      },
    };
  }

  async moderate(actor: User, customerId: number, dto: AdminUserModerationDto) {
    const customer = await this.requireCustomer(customerId);
    if (dto.action !== 'reactivate' && !dto.reason?.trim()) {
      throw new BadRequestException('A reason is required when suspending or banning a customer');
    }
    if (dto.action === 'suspend' && customer.customerProfile?.status === 'deactivated') {
      throw new ConflictException('A deactivated/banned customer cannot be suspended');
    }
    if (dto.action === 'suspend' && customer.customerProfile?.status === 'suspended') {
      throw new ConflictException('Customer is already suspended');
    }
    if (dto.action === 'ban' && customer.customerProfile?.status === 'deactivated') {
      throw new ConflictException('Customer is already deactivated/banned');
    }
    if (dto.action === 'reactivate' && customer.customerProfile?.status === 'active') {
      throw new ConflictException('Customer is already active');
    }
    if (
      dto.action === 'reactivate' &&
      customer.customerProfile?.status === 'deactivated' &&
      actor.role !== UserRole.SuperAdmin
    ) {
      throw new ForbiddenException(
        'Only the super administrator may reactivate a deactivated/banned customer',
      );
    }

    const nextStatus =
      dto.action === 'suspend' ? 'suspended' : dto.action === 'ban' ? 'deactivated' : 'active';

    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.customerProfile.update({
        where: { userId: customerId },
        data: {
          status: nextStatus,
          suspendedAt: nextStatus === 'suspended' ? new Date() : null,
          deactivatedAt: nextStatus === 'deactivated' ? new Date() : null,
          statusReason: nextStatus === 'active' ? null : dto.reason?.trim() ?? null,
        },
      });
      if (dto.action !== 'reactivate') {
        await this.sessions.revokeRole(customerId, UserRole.Customer, transaction);
      }
      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: customerId,
          action: `customer_${dto.action === 'ban' ? 'banned' : dto.action === 'suspend' ? 'suspended' : 'reactivated'}`,
          entityType: 'customer',
          entityId: customerId,
          reason: dto.reason,
          metadata: { previousStatus: customer.customerProfile?.status ?? customer.accountStatus, nextStatus },
        },
        transaction,
      );
      await this.notifications.create(
        customerId,
        {
          category: 'system',
          type: `account_${nextStatus}`,
          title:
            dto.action === 'reactivate'
              ? 'Account reactivated'
              : dto.action === 'suspend'
                ? 'Account suspended'
                : 'Account deactivated',
          body:
            dto.reason?.trim() ||
            'Your Latache account status has been updated by an administrator.',
          entityType: 'account',
          entityId: String(customerId),
        },
        transaction,
      );
      return changed;
    });

    return {
      id: String(customerId),
      accountStatus: updated.status,
      action: dto.action,
      sessionsRevoked: dto.action !== 'reactivate',
    };
  }

  private async requireCustomer(customerId: number) {
    const customer = await this.prisma.user.findFirst({
      where: { id: customerId, roles: { has: UserRole.Customer }, deletedAt: null, customerProfile: { isNot: null } },
      include: { customerProfile: true },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }
}
