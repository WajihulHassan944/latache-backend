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
  AdminCustomerProfileUpdateDto,
  AdminDateRangeQueryDto,
  AdminUserModerationDto,
  ListAdminCustomersDto,
} from '../dto';
import {
  dateFilter,
  fullName,
  money,
  pagination,
  parseCityArea,
  percentage,
  resolveAdminDateRange,
} from '../admin-dashboard.utils';
import { AccountDeletionService } from '../../account-deletion/account-deletion.service';
import { PlatformSettingsService } from '../../platform-settings/platform-settings.service';

type CustomerWithProfile = Prisma.UserGetPayload<{ include: { customerProfile: true } }>;

interface RawCustomerListRow {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  zipCode: string | null;
  profilePicture: string | null;
  accountStatus: string;
  cpStatus: string | null;
  cpRating: Prisma.Decimal | number | string | null;
  cpReviewsCount: number | null;
  cpStatusReason: string | null;
  cpSuspendedUntil: Date | null;
  cpSuspendedAt: Date | null;
  cpDeactivatedAt: Date | null;
  userRating: Prisma.Decimal | number | string;
  userReviewsCount: number;
  lastLoginAt: Date | null;
  createdAt: Date;
  bookingsCount: number;
  totalSpent: Prisma.Decimal | number | string;
  defaultAddress: string | null;
}

const ACTIVE_DISPUTE_STATUSES = ['open', 'under_investigation', 'escalated'] as const;

@Injectable()
export class AdminCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsRepository,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly accountDeletion: AccountDeletionService,
    private readonly platformSettings: PlatformSettingsService,
  ) {}

  permanentlyDelete(actor: User, customerId: number, reason: string) {
    return this.accountDeletion.permanentlyDelete(actor, customerId, UserRole.Customer, reason);
  }

  async list(actor: User, query: ListAdminCustomersDto) {
    if (
      (query.ipAddress || query.nearLat !== undefined || query.nearLng !== undefined) &&
      actor.role !== UserRole.SuperAdmin &&
      !actor.permissions.includes('customers.read_sensitive')
    ) {
      throw new ForbiddenException(
        'customers.read_sensitive is required to filter customers by IP address or saved location',
      );
    }
    const { page, limit, skip } = pagination(query.page, query.limit);
    const search = query.search?.trim();
    const phoneDigits = query.phone?.replace(/\D/g, '') ?? '';
    const phoneIds = phoneDigits
      ? await this.prisma.$queryRaw<Array<{ id: number }>>`
          SELECT "id" FROM "Users"
          WHERE regexp_replace(COALESCE("phoneCountryCode", '') || COALESCE("phoneNumber", ''), '\D', '', 'g')
                LIKE ${`%${phoneDigits}%`}
        `
      : null;
    const ipAddress = query.ipAddress?.trim();
    const ipUserIds = ipAddress ? await this.sessions.findUserIdsByIpAddress(ipAddress) : null;
    const fromDate = query.from ? new Date(`${query.from}T00:00:00.000Z`) : null;
    const toExclusive = query.to
      ? new Date(new Date(`${query.to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000)
      : null;
    const location = query.location?.trim();
    // Bounding-box approximation, not an exact circle: cheap to express as a
    // relational Decimal range predicate against the customer's default
    // CustomerAddress on the existing findMany() below, without switching
    // this list query to raw SQL for one admin filter.
    // 1 degree latitude ~= 111km; degrees-per-km for longitude shrinks with
    // cos(latitude), same approximation the platform already documents for
    // "activeCurrencies"-style static presets elsewhere.
    const nearBox =
      query.nearLat !== undefined && query.nearLng !== undefined
        ? (() => {
            const radiusKm = query.radiusKm ?? 20;
            const latDelta = radiusKm / 111;
            const lngDelta = radiusKm / (111 * Math.max(0.01, Math.cos((query.nearLat * Math.PI) / 180)));
            return {
              latMin: query.nearLat - latDelta,
              latMax: query.nearLat + latDelta,
              lngMin: query.nearLng - lngDelta,
              lngMax: query.nearLng + lngDelta,
            };
          })()
        : null;
    const where: Prisma.UserWhereInput = {
      roles: { has: UserRole.Customer },
      deletedAt: null,
      customerProfile: { isNot: null },
      ...(phoneIds ? { id: { in: phoneIds.map((row) => row.id) } } : {}),
      ...(ipUserIds ? { id: { in: ipUserIds } } : {}),
      ...(nearBox
        ? {
            savedAddresses: {
              some: {
                isDefault: true,
                latitude: { gte: nearBox.latMin, lte: nearBox.latMax },
                longitude: { gte: nearBox.lngMin, lte: nearBox.lngMax },
              },
            },
          }
        : {}),
      ...(fromDate || toExclusive
        ? {
            createdAt: {
              ...(fromDate ? { gte: fromDate } : {}),
              ...(toExclusive ? { lt: toExclusive } : {}),
            },
          }
        : {}),
      ...(location
        ? {
            bookingsAsCustomer: {
              some: {
                OR: [
                  { venueAddress: { contains: location, mode: 'insensitive' } },
                  { locationLabel: { contains: location, mode: 'insensitive' } },
                  { locationCity: { contains: location, mode: 'insensitive' } },
                  { locationArea: { contains: location, mode: 'insensitive' } },
                ],
              },
            },
          }
        : {}),
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

    const currency = await this.platformSettings.currencyContext();

    if (query.sort === 'name_asc' || query.sort === 'spend_desc') {
      return this.listViaRawSql(query, {
        page,
        limit,
        skip,
        search,
        phoneIds,
        ipUserIds,
        nearBox,
        fromDate,
        toExclusive,
        location,
        currencyCode: currency.code,
      });
    }

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
          customerProfile: {
            select: {
              status: true,
              rating: true,
              reviewsCount: true,
              statusReason: true,
              suspendedUntil: true,
              suspendedAt: true,
              deactivatedAt: true,
            },
          },
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
    const [spendRows, addressRows] = await Promise.all([
      ids.length
        ? this.prisma.paymentTransaction.groupBy({
            by: ['customerId'],
            where: { customerId: { in: ids }, kind: 'booking_charge', status: 'succeeded' },
            _sum: { amount: true },
          })
        : Promise.resolve([]),
      ids.length
        ? this.prisma.customerAddress.findMany({
            where: { customerId: { in: ids }, isDefault: true },
            select: { customerId: true, address: true },
          })
        : Promise.resolve([]),
    ]);
    const spendByCustomer = new Map(
      spendRows.map((row) => [row.customerId, money(row._sum.amount)]),
    );
    const addressByCustomer = new Map(
      addressRows.map((row) => [row.customerId, parseCityArea(row.address)]),
    );

    return {
      currency: currency.code,
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
        statusReason: customer.customerProfile?.statusReason ?? null,
        suspendedUntil: customer.customerProfile?.suspendedUntil?.toISOString() ?? null,
        suspendedAt: customer.customerProfile?.suspendedAt?.toISOString() ?? null,
        deactivatedAt: customer.customerProfile?.deactivatedAt?.toISOString() ?? null,
        ...(addressByCustomer.get(customer.id) ?? { city: null, area: null }),
      })),
      pagination: { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit) },
    };
  }

  /**
   * Special-cased raw-SQL path for sort modes that need DB-level ordering
   * before pagination (name_asc: case-insensitive display name; spend_desc:
   * total successful booking-charge spend). The main list() stays on the
   * Prisma query builder for its other sort modes; this mirrors the same
   * filters by hand because Prisma's query builder can't express either
   * ordering key directly. See taskers.repository.ts for the CTE pattern
   * this follows.
   */
  private async listViaRawSql(
    query: ListAdminCustomersDto,
    ctx: {
      page: number;
      limit: number;
      skip: number;
      search?: string;
      phoneIds: Array<{ id: number }> | null;
      ipUserIds: number[] | null;
      nearBox: { latMin: number; latMax: number; lngMin: number; lngMax: number } | null;
      fromDate: Date | null;
      toExclusive: Date | null;
      location?: string;
      currencyCode: string;
    },
  ) {
    const { page, limit, skip, search, phoneIds, ipUserIds, nearBox, fromDate, toExclusive, location, currencyCode } =
      ctx;

    const conditions: Prisma.Sql[] = [
      Prisma.sql`${UserRole.Customer} = ANY(u."roles")`,
      Prisma.sql`u."deletedAt" IS NULL`,
      Prisma.sql`EXISTS (SELECT 1 FROM "CustomerProfiles" rcp WHERE rcp."userId" = u."id")`,
    ];
    if (phoneIds) {
      const ids = phoneIds.map((row) => row.id);
      conditions.push(ids.length ? Prisma.sql`u."id" IN (${Prisma.join(ids)})` : Prisma.sql`false`);
    }
    if (ipUserIds) {
      conditions.push(
        ipUserIds.length ? Prisma.sql`u."id" IN (${Prisma.join(ipUserIds)})` : Prisma.sql`false`,
      );
    }
    if (nearBox) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "CustomerAddresses" nca
        WHERE nca."customerId" = u."id" AND nca."isDefault" = true
          AND nca."latitude" BETWEEN ${nearBox.latMin} AND ${nearBox.latMax}
          AND nca."longitude" BETWEEN ${nearBox.lngMin} AND ${nearBox.lngMax}
      )`);
    }
    if (fromDate) conditions.push(Prisma.sql`u."createdAt" >= ${fromDate}`);
    if (toExclusive) conditions.push(Prisma.sql`u."createdAt" < ${toExclusive}`);
    if (location) {
      const like = `%${location}%`;
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM "Bookings" lb
        WHERE lb."customerId" = u."id"
          AND (
            lb."venueAddress" ILIKE ${like}
            OR lb."locationLabel" ILIKE ${like}
            OR lb."locationCity" ILIKE ${like}
            OR lb."locationArea" ILIKE ${like}
          )
      )`);
    }
    if (query.status === 'pending_verification') {
      conditions.push(Prisma.sql`u."accountStatus" = ${AccountStatus.PendingVerification}`);
    } else if (query.status) {
      conditions.push(Prisma.sql`cp."status" = ${query.status}`);
    }
    if (search) {
      const like = `%${search}%`;
      conditions.push(Prisma.sql`(
        u."firstName" ILIKE ${like} OR u."lastName" ILIKE ${like}
        OR u."email" ILIKE ${like} OR u."phoneNumber" ILIKE ${like}
      )`);
    }

    const cte = Prisma.sql`
      WITH base AS (
        SELECT
          u."id", u."firstName", u."lastName", u."email", u."phoneCountryCode", u."phoneNumber",
          u."zipCode", u."profilePicture", u."accountStatus",
          cp."status" AS "cpStatus", cp."rating" AS "cpRating", cp."reviewsCount" AS "cpReviewsCount",
          cp."statusReason" AS "cpStatusReason", cp."suspendedUntil" AS "cpSuspendedUntil",
          cp."suspendedAt" AS "cpSuspendedAt", cp."deactivatedAt" AS "cpDeactivatedAt",
          u."rating" AS "userRating", u."reviewsCount" AS "userReviewsCount",
          u."lastLoginAt", u."createdAt",
          (SELECT COUNT(*)::int FROM "Bookings" b WHERE b."customerId" = u."id") AS "bookingsCount",
          COALESCE((
            SELECT SUM(pt."amount") FROM "PaymentTransactions" pt
            WHERE pt."customerId" = u."id" AND pt."kind" = 'booking_charge' AND pt."status" = 'succeeded'
          ), 0) AS "totalSpent",
          (
            SELECT ca."address" FROM "CustomerAddresses" ca
            WHERE ca."customerId" = u."id" AND ca."isDefault" = true
            LIMIT 1
          ) AS "defaultAddress"
        FROM "Users" u
        LEFT JOIN "CustomerProfiles" cp ON cp."userId" = u."id"
        WHERE ${Prisma.join(conditions, ' AND ')}
      )
    `;

    const orderSql =
      query.sort === 'spend_desc'
        ? Prisma.sql`"totalSpent" DESC, "id" ASC`
        : Prisma.sql`lower(concat_ws(' ', "firstName", "lastName")) ASC, "id" ASC`;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<RawCustomerListRow[]>(
        Prisma.sql`${cte} SELECT * FROM base ORDER BY ${orderSql} LIMIT ${limit} OFFSET ${skip}`,
      ),
      this.prisma.$queryRaw<Array<{ total: number }>>(
        Prisma.sql`${cte} SELECT COUNT(*)::int AS total FROM base`,
      ),
    ]);
    const totalItems = countRows[0]?.total ?? 0;

    return {
      currency: currencyCode,
      items: rows.map((row) => ({
        id: String(row.id),
        customerId: `CUS-${String(row.id).padStart(5, '0')}`,
        name: fullName(row.firstName, row.lastName),
        email: row.email,
        phone: `${row.phoneCountryCode ?? ''}${row.phoneNumber ?? ''}`,
        zipCode: row.zipCode ?? '',
        profilePicture: row.profilePicture ?? '',
        accountStatus:
          row.accountStatus === AccountStatus.PendingVerification
            ? row.accountStatus
            : (row.cpStatus ?? row.accountStatus),
        bookingsCount: row.bookingsCount,
        totalSpent: money(row.totalSpent),
        rating: Number(row.cpRating ?? row.userRating),
        reviewsCount: row.cpReviewsCount ?? row.userReviewsCount,
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        joinedAt: row.createdAt.toISOString(),
        statusReason: row.cpStatusReason ?? null,
        suspendedUntil: row.cpSuspendedUntil?.toISOString() ?? null,
        suspendedAt: row.cpSuspendedAt?.toISOString() ?? null,
        deactivatedAt: row.cpDeactivatedAt?.toISOString() ?? null,
        ...parseCityArea(row.defaultAddress),
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
    const [rows, totalItems, collected, bookingValue, refunded, disputed, currency] = await Promise.all([
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
      this.platformSettings.currencyContext(),
    ]);
    return {
      currency: currency.code,
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
    const [bookingCounts, spend, recentBookings, recentPayments, reviewsReceived, currency] =
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
        this.platformSettings.currencyContext(),
      ]);

    return {
      currency: currency.code,
      customer: this.serializeCustomerProfile(customer),
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
    const [totalCustomers, statusRows, topSpendRows, createdInPeriod, currency] = await Promise.all([
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
      this.platformSettings.currencyContext(),
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
      currency: currency.code,
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

    if (dto.until !== undefined && dto.action !== 'suspend') {
      throw new BadRequestException('until can only be supplied together with action=suspend');
    }
    let until: Date | null = null;
    if (dto.until !== undefined) {
      until = new Date(dto.until);
      if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
        throw new BadRequestException('until must be a valid date in the future');
      }
    }

    const nextStatus =
      dto.action === 'suspend' ? 'suspended' : dto.action === 'ban' ? 'deactivated' : 'active';

    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.customerProfile.update({
        where: { userId: customerId },
        data:
          nextStatus === 'active'
            ? this.reactivationData()
            : {
                status: nextStatus,
                suspendedAt: nextStatus === 'suspended' ? new Date() : null,
                deactivatedAt: nextStatus === 'deactivated' ? new Date() : null,
                statusReason: dto.reason?.trim() ?? null,
                suspendedUntil: nextStatus === 'suspended' ? until : null,
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

  /**
   * Field reset shared by the manual 'reactivate' moderation action and the
   * hourly auto-reactivation sweep for elapsed suspendedUntil timers, so both
   * paths clear exactly the same CustomerProfile fields.
   */
  private reactivationData(): Prisma.CustomerProfileUpdateInput {
    return {
      status: 'active',
      suspendedAt: null,
      deactivatedAt: null,
      statusReason: null,
      suspendedUntil: null,
    };
  }

  /**
   * Hourly maintenance sweep (wired into PerformanceJobsService): reactivates
   * any customer whose timed suspension (suspendedUntil) has elapsed.
   */
  async reactivateDueSuspensions(): Promise<{ reactivated: number }> {
    const due = await this.prisma.customerProfile.findMany({
      where: { status: 'suspended', suspendedUntil: { lte: new Date() } },
      select: { userId: true },
    });

    for (const row of due) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.customerProfile.update({
          where: { userId: row.userId },
          data: this.reactivationData(),
        });
        await this.audit.record(
          {
            actorId: null,
            targetUserId: row.userId,
            action: 'customer_auto_reactivated',
            entityType: 'customer',
            entityId: row.userId,
            metadata: { reason: 'suspendedUntil elapsed' },
          },
          transaction,
        );
        await this.notifications.create(
          row.userId,
          {
            category: 'system',
            type: 'account_active',
            title: 'Account reactivated',
            body: 'Your suspension period has ended and your Latache account is active again.',
            entityType: 'account',
            entityId: String(row.userId),
          },
          transaction,
        );
      });
    }

    return { reactivated: due.length };
  }

  async updateProfile(actor: User, customerId: number, dto: AdminCustomerProfileUpdateDto) {
    if (
      dto.firstName === undefined &&
      dto.lastName === undefined &&
      dto.email === undefined &&
      dto.phoneCountryCode === undefined &&
      dto.phoneNumber === undefined
    ) {
      throw new BadRequestException('At least one field must be provided');
    }

    const customer = await this.requireCustomer(customerId);

    let normalizedEmail: string | undefined;
    if (dto.email !== undefined) {
      normalizedEmail = dto.email.trim().toLowerCase();
      const existingEmail = await this.prisma.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: 'insensitive' }, id: { not: customerId } },
        select: { id: true },
      });
      if (existingEmail) throw new ConflictException('An account with this email already exists');
    }

    const nextCountryCode = dto.phoneCountryCode ?? customer.phoneCountryCode;
    const nextPhoneNumber = dto.phoneNumber ?? customer.phoneNumber;
    if ((dto.phoneCountryCode !== undefined || dto.phoneNumber !== undefined) && nextCountryCode && nextPhoneNumber) {
      const existingPhone = await this.prisma.user.findFirst({
        where: { phoneCountryCode: nextCountryCode, phoneNumber: nextPhoneNumber, id: { not: customerId } },
        select: { id: true },
      });
      if (existingPhone) {
        throw new ConflictException('An account with this phone number already exists');
      }
    }

    const data: Prisma.UserUpdateInput = {
      ...(dto.firstName === undefined ? {} : { firstName: dto.firstName }),
      ...(dto.lastName === undefined ? {} : { lastName: dto.lastName }),
      ...(normalizedEmail === undefined ? {} : { email: normalizedEmail }),
      ...(dto.phoneCountryCode === undefined ? {} : { phoneCountryCode: dto.phoneCountryCode }),
      ...(dto.phoneNumber === undefined ? {} : { phoneNumber: dto.phoneNumber }),
    };

    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.user.update({
        where: { id: customerId },
        data,
        include: { customerProfile: true },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: customerId,
          action: 'customer_profile_updated',
          entityType: 'customer',
          entityId: customerId,
          metadata: { fields: Object.keys(data) },
        },
        transaction,
      );
      return changed;
    });

    return { customer: this.serializeCustomerProfile(updated) };
  }

  private serializeCustomerProfile(customer: CustomerWithProfile) {
    return {
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
      statusReason: customer.customerProfile?.statusReason ?? null,
      suspendedUntil: customer.customerProfile?.suspendedUntil?.toISOString() ?? null,
      suspendedAt: customer.customerProfile?.suspendedAt?.toISOString() ?? null,
      deactivatedAt: customer.customerProfile?.deactivatedAt?.toISOString() ?? null,
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
