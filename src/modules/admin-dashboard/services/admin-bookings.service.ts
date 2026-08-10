import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type User } from '../../../generated/prisma/client';
import { UserRole } from '../../../common/enums/user-role.enum';
import { PrismaService } from '../../../database/prisma.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { PAYMENT_STATUS } from '../../payments/payments.constants';
import type {
  AdminBookingActionDto,
  AdminBookingsQueryDto,
} from '../dto';
import { fullName, money, pagination } from '../admin-dashboard.utils';

const ACTIVE_BOOKING_STATUSES = [
  'pending',
  'confirmed',
  'en_route',
  'arrived',
  'in_progress',
] as const;
const ACTIVE_DISPUTE_STATUSES = ['open', 'under_investigation', 'escalated'] as const;
const MAX_CSV_ROWS = 10_000;

const startOfUtcMonth = (now = new Date()): Date =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

const parseDateRange = (from?: string, to?: string) => {
  if ((from && !to) || (!from && to)) {
    throw new ConflictException('from and to must be supplied together');
  }
  if (!from || !to) return undefined;
  const start = new Date(`${from}T00:00:00.000Z`);
  const inclusiveEnd = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(inclusiveEnd.getTime())) {
    throw new ConflictException('Invalid booking date range');
  }
  if (start > inclusiveEnd) throw new ConflictException('from must be earlier than or equal to to');
  return { gte: start, lt: new Date(inclusiveEnd.getTime() + 86_400_000) };
};

const bookingDisplayId = (id: number): string => `B-${String(id).padStart(4, '0')}`;

const escapeCsv = (value: unknown): string => {
  const stringValue = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(stringValue)
    ? `"${stringValue.replaceAll('"', '""')}"`
    : stringValue;
};

@Injectable()
export class AdminBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminBookingsQueryDto) {
    const { page, limit, skip } = pagination(query.page, query.limit);
    const baseWhere = this.baseWhere(query);
    const where = this.viewWhere(baseWhere, query.view ?? 'all');
    const orderBy = this.orderBy(query.sort);
    const monthStart = startOfUtcMonth();

    const [rows, totalItems, totalVolume, activeTasks, completedMtd, cancelledMtd, disputed] =
      await Promise.all([
        this.prisma.booking.findMany({
          where,
          select: this.listSelect(),
          orderBy,
          skip,
          take: limit,
        }),
        this.prisma.booking.count({ where }),
        this.prisma.booking.count({ where: baseWhere }),
        this.prisma.booking.count({
          where: { ...baseWhere, status: { in: [...ACTIVE_BOOKING_STATUSES] } },
        }),
        this.prisma.booking.count({
          where: {
            ...baseWhere,
            status: 'completed',
            taskCompletedAt: { gte: monthStart },
          },
        }),
        this.prisma.booking.count({
          where: {
            ...baseWhere,
            status: 'cancelled',
            cancelledAt: { gte: monthStart },
          },
        }),
        this.prisma.booking.count({
          where: {
            ...baseWhere,
            complaints: { some: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } },
          },
        }),
      ]);

    return {
      summary: {
        totalVolume,
        activeTasks,
        completedMtd,
        cancelledMtd,
        disputed,
      },
      view: query.view ?? 'all',
      items: rows.map((booking) => this.listItem(booking)),
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },
    };
  }

  async csv(actor: User, query: AdminBookingsQueryDto): Promise<{ body: string; truncated: boolean }> {
    if (actor.role !== UserRole.SuperAdmin && !actor.permissions.includes('reports.read')) {
      throw new ForbiddenException('CSV booking export requires reports.read in addition to bookings.read');
    }
    const baseWhere = this.baseWhere(query);
    const where = this.viewWhere(baseWhere, query.view ?? 'all');
    const rows = await this.prisma.booking.findMany({
      where,
      select: this.listSelect(),
      orderBy: this.orderBy(query.sort),
      take: MAX_CSV_ROWS + 1,
    });
    const truncated = rows.length > MAX_CSV_ROWS;
    const exported = rows.slice(0, MAX_CSV_ROWS).map((booking) => this.listItem(booking));
    const header = [
      'booking_id',
      'service',
      'date',
      'start_time',
      'customer',
      'tasker',
      'status',
      'payment_status',
      'amount',
      'currency',
      'active_disputes',
    ];
    const lines = exported.map((row) => [
      row.bookingId,
      row.service.name ?? '',
      row.date,
      row.startTime,
      row.customer.name,
      row.tasker.name,
      row.status,
      row.payment.status,
      row.amount.amount,
      row.amount.currency,
      row.activeDisputes,
    ].map(escapeCsv).join(','));
    return { body: [header.join(','), ...lines].join('\n'), truncated };
  }

  async details(id: number) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneCountryCode: true,
            phoneNumber: true,
            profilePicture: true,
            accountStatus: true,
          },
        },
        tasker: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phoneCountryCode: true,
            phoneNumber: true,
            profilePicture: true,
            accountStatus: true,
            rating: true,
            isElite: true,
            eliteTier: { select: { code: true, name: true } },
          },
        },
        service: true,
        serviceOption: true,
        availability: true,
        workSession: true,
        latestLocation: true,
        complaints: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            category: true,
            status: true,
            priority: true,
            createdAt: true,
            resolvedAt: true,
            resolutionType: true,
            resolutionAmount: true,
            resolutionCurrency: true,
          },
        },
        paymentTransactions: { orderBy: { createdAt: 'desc' } },
        _count: { select: { messages: true, reviews: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const audit = await this.prisma.adminAuditLog.findMany({
      where: { entityType: 'booking', entityId: String(id) },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { actor: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });

    return {
      id: String(booking.id),
      bookingId: bookingDisplayId(booking.id),
      status: booking.status,
      service: {
        id: String(booking.service.id),
        name: booking.service.name,
        slug: booking.service.slug,
        option: booking.serviceOption
          ? {
              id: String(booking.serviceOption.id),
              name: booking.serviceOption.name,
              slug: booking.serviceOption.slug,
            }
          : null,
      },
      customer: {
        id: String(booking.customer.id),
        name: fullName(booking.customer.firstName, booking.customer.lastName),
        email: booking.customer.email,
        phone: `${booking.customer.phoneCountryCode ?? ''}${booking.customer.phoneNumber ?? ''}`,
        profilePicture: booking.customer.profilePicture ?? '',
        accountStatus: booking.customer.accountStatus,
      },
      tasker: {
        id: String(booking.tasker.id),
        name: fullName(booking.tasker.firstName, booking.tasker.lastName),
        email: booking.tasker.email,
        phone: `${booking.tasker.phoneCountryCode ?? ''}${booking.tasker.phoneNumber ?? ''}`,
        profilePicture: booking.tasker.profilePicture ?? '',
        accountStatus: booking.tasker.accountStatus,
        rating: Number(booking.tasker.rating),
        isElite: booking.tasker.isElite,
        eliteTier: booking.tasker.eliteTier,
      },
      schedule: {
        date: booking.bookingDate.toISOString().slice(0, 10),
        startTime: booking.startTime,
        endTime: booking.endTime,
        estimatedDurationMinutes: booking.estimatedDurationMinutes,
        extensionMinutes: booking.extensionMinutes,
      },
      location: {
        label: booking.locationLabel,
        address: booking.venueAddress,
        apartmentSuite: booking.apartmentSuite,
        lat: Number(booking.locationLat),
        lng: Number(booking.locationLng),
        city: booking.locationCity,
        area: booking.locationArea,
      },
      description: booking.description,
      attachments: Array.isArray(booking.attachments) ? booking.attachments : [],
      lifecycle: {
        confirmedAt: booking.confirmedAt?.toISOString() ?? null,
        enRouteAt: booking.enRouteAt?.toISOString() ?? null,
        arrivedAt: booking.arrivedAt?.toISOString() ?? null,
        taskStartedAt: booking.taskStartedAt?.toISOString() ?? null,
        taskCompletedAt: booking.taskCompletedAt?.toISOString() ?? null,
        cancelledAt: booking.cancelledAt?.toISOString() ?? null,
        cancelledByRole: booking.cancelledByRole,
        cancellationReason: booking.cancellationReason,
        rescheduledAt: booking.rescheduledAt?.toISOString() ?? null,
      },
      workSession: booking.workSession
        ? {
            status: booking.workSession.status,
            startedAt: booking.workSession.startedAt.toISOString(),
            pausedAt: booking.workSession.pausedAt?.toISOString() ?? null,
            stoppedAt: booking.workSession.stoppedAt?.toISOString() ?? null,
            notes: booking.workSession.notes,
          }
        : null,
      latestTaskerLocation: booking.latestLocation
        ? {
            lat: Number(booking.latestLocation.lat),
            lng: Number(booking.latestLocation.lng),
            capturedAt: booking.latestLocation.capturedAt.toISOString(),
          }
        : null,
      payment: {
        source: booking.paymentSource,
        status: booking.paymentStatus,
        currency: booking.paymentCurrency,
        serviceAmount: booking.serviceAmount === null ? null : money(booking.serviceAmount),
        platformFeeAmount: money(booking.platformFeeAmount),
        commissionRatePercent: money(booking.commissionRatePercent),
        taxAmount: money(booking.taxAmount),
        taxRatePercent: money(booking.taxRatePercent),
        taxInclusive: booking.taxInclusive,
        serviceSurchargeAmount: money(booking.serviceSurchargeAmount),
        tipAmount: money(booking.tipAmount),
        donationAmount: money(booking.donationAmount),
        totalChargedAmount: booking.totalChargedAmount === null ? null : money(booking.totalChargedAmount),
        paidAt: booking.paidAt?.toISOString() ?? null,
        stripePaymentIntentId: booking.stripePaymentIntentId,
        failureReason: booking.paymentFailureReason,
        transactions: booking.paymentTransactions.map((transaction) => ({
          id: transaction.id,
          kind: transaction.kind,
          provider: transaction.provider,
          providerReference: transaction.providerReference,
          status: transaction.status,
          amount: money(transaction.amount),
          currency: transaction.currency,
          failureReason: transaction.failureReason,
          createdAt: transaction.createdAt.toISOString(),
        })),
      },
      complaints: booking.complaints.map((complaint) => ({
        id: complaint.id,
        displayId: this.disputeDisplayId(complaint.id),
        category: complaint.category,
        status: complaint.status,
        priority: complaint.priority,
        resolutionType: complaint.resolutionType,
        resolutionAmount: complaint.resolutionAmount === null ? null : money(complaint.resolutionAmount),
        resolutionCurrency: complaint.resolutionCurrency,
        createdAt: complaint.createdAt.toISOString(),
        resolvedAt: complaint.resolvedAt?.toISOString() ?? null,
      })),
      counts: { messages: booking._count.messages, reviews: booking._count.reviews },
      audit: audit.map((event) => ({
        id: event.id,
        action: event.action,
        reason: event.reason,
        metadata: event.metadata,
        actor: event.actor
          ? {
              id: String(event.actor.id),
              name: fullName(event.actor.firstName, event.actor.lastName),
              email: event.actor.email,
            }
          : null,
        createdAt: event.createdAt.toISOString(),
      })),
      availableAdminActions: this.availableActions(booking.status, booking.paymentStatus, booking.complaints),
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    };
  }

  async action(actor: User, id: number, dto: AdminBookingActionDto) {
    if (dto.action !== 'cancel') throw new ConflictException('Unsupported booking action');
    const reason = dto.reason.trim();
    if (reason.length < 5) throw new ConflictException('A meaningful cancellation reason is required');

    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${id} FOR UPDATE`;
      const booking = await transaction.booking.findUnique({
        where: { id },
        include: {
          complaints: { where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } }, select: { id: true } },
        },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.complaints.length > 0) {
        throw new ConflictException('Resolve active booking disputes before administrative cancellation');
      }
      if (!['pending', 'confirmed', 'en_route', 'arrived'].includes(booking.status)) {
        throw new ConflictException('Only pending, accepted, en-route, or arrived bookings can be administratively cancelled');
      }
      if ([PAYMENT_STATUS.Paid, PAYMENT_STATUS.PartiallyRefunded, PAYMENT_STATUS.Refunded].includes(booking.paymentStatus as never)) {
        throw new ConflictException('A settled booking must be handled through dispute/refund resolution, not direct cancellation');
      }

      const row = await transaction.booking.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledByRole: actor.role,
          cancellationReason: reason,
        },
      });
      await transaction.userAvailability.updateMany({
        where: { id: booking.availabilityId },
        data: { isBooked: false },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'booking_admin_cancelled',
          entityType: 'booking',
          entityId: id,
          reason,
          metadata: { previousStatus: booking.status },
        },
        transaction,
      );
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'booking_cancelled_by_admin',
          title: 'Booking cancelled by Latache',
          body: reason,
          entityType: 'booking',
          entityId: String(id),
        },
        transaction,
      );
      await this.notifications.create(
        booking.taskerId,
        {
          category: 'tasks',
          type: 'booking_cancelled_by_admin',
          title: 'Booking cancelled by Latache',
          body: reason,
          entityType: 'booking',
          entityId: String(id),
        },
        transaction,
      );
      return row;
    });

    return {
      bookingId: String(updated.id),
      displayId: bookingDisplayId(updated.id),
      status: updated.status,
      cancelledAt: updated.cancelledAt?.toISOString() ?? null,
      cancellationReason: updated.cancellationReason,
    };
  }

  private baseWhere(query: AdminBookingsQueryDto): Prisma.BookingWhereInput {
    const search = query.search?.trim();
    const numericSearch = search
      ? Number.parseInt(search.replace(/^(BKG-|B-)/i, ''), 10)
      : Number.NaN;
    const date = parseDateRange(query.from, query.to);
    return {
      ...(date ? { bookingDate: date } : {}),
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.taskerId ? { taskerId: query.taskerId } : {}),
      ...(query.paymentStatus && query.paymentStatus !== 'all'
        ? { paymentStatus: query.paymentStatus }
        : {}),
      ...(search
        ? {
            OR: [
              ...(Number.isInteger(numericSearch) && numericSearch > 0
                ? [{ id: numericSearch }]
                : []),
              { service: { name: { contains: search, mode: 'insensitive' } } },
              { customer: { firstName: { contains: search, mode: 'insensitive' } } },
              { customer: { lastName: { contains: search, mode: 'insensitive' } } },
              { customer: { email: { contains: search, mode: 'insensitive' } } },
              { tasker: { firstName: { contains: search, mode: 'insensitive' } } },
              { tasker: { lastName: { contains: search, mode: 'insensitive' } } },
              { tasker: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
  }

  private viewWhere(baseWhere: Prisma.BookingWhereInput, view: AdminBookingsQueryDto['view']): Prisma.BookingWhereInput {
    if (!view || view === 'all') return baseWhere;
    if (view === 'pending') return { ...baseWhere, status: 'pending' };
    if (view === 'accepted') return { ...baseWhere, status: 'confirmed' };
    if (view === 'in_progress') {
      return { ...baseWhere, status: { in: ['en_route', 'arrived', 'in_progress'] } };
    }
    if (view === 'completed') return { ...baseWhere, status: 'completed' };
    if (view === 'cancelled') return { ...baseWhere, status: 'cancelled' };
    return {
      ...baseWhere,
      complaints: { some: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } } },
    };
  }

  private orderBy(sort: AdminBookingsQueryDto['sort']): Prisma.BookingOrderByWithRelationInput[] {
    if (sort === 'oldest') return [{ createdAt: 'asc' }, { id: 'asc' }];
    if (sort === 'amount_desc') return [{ totalChargedAmount: 'desc' }, { createdAt: 'desc' }];
    if (sort === 'amount_asc') return [{ totalChargedAmount: 'asc' }, { createdAt: 'desc' }];
    return [{ createdAt: 'desc' }, { id: 'desc' }];
  }

  private listSelect() {
    return {
      id: true,
      status: true,
      bookingDate: true,
      startTime: true,
      paymentStatus: true,
      paymentCurrency: true,
      hourlyRate: true,
      estimatedDurationMinutes: true,
      serviceAmount: true,
      platformFeeAmount: true,
      commissionRatePercent: true,
      taxAmount: true,
      taxRatePercent: true,
      taxInclusive: true,
      serviceSurchargeAmount: true,
      tipAmount: true,
      donationAmount: true,
      totalChargedAmount: true,
      createdAt: true,
      service: { select: { id: true, name: true, slug: true } },
      customer: { select: { id: true, firstName: true, lastName: true, email: true } },
      tasker: { select: { id: true, firstName: true, lastName: true, email: true } },
      complaints: {
        where: { status: { in: [...ACTIVE_DISPUTE_STATUSES] } },
        select: { id: true, priority: true },
      },
    } satisfies Prisma.BookingSelect;
  }

  private listItem(booking: any) {
    const estimatedServiceAmount =
      booking.serviceAmount === null
        ? money(Number(booking.hourlyRate) * (booking.estimatedDurationMinutes / 60))
        : money(booking.serviceAmount);
    const estimatedTotal = money(
      estimatedServiceAmount +
        Number(booking.platformFeeAmount) +
        (booking.taxInclusive ? 0 : Number(booking.taxAmount ?? 0)) +
        Number(booking.serviceSurchargeAmount ?? 0) +
        Number(booking.tipAmount) +
        Number(booking.donationAmount),
    );
    return {
      id: String(booking.id),
      bookingId: bookingDisplayId(booking.id),
      service: booking.service,
      date: booking.bookingDate.toISOString().slice(0, 10),
      startTime: booking.startTime,
      customer: {
        id: String(booking.customer.id),
        name: fullName(booking.customer.firstName, booking.customer.lastName),
        email: booking.customer.email,
      },
      tasker: {
        id: String(booking.tasker.id),
        name: fullName(booking.tasker.firstName, booking.tasker.lastName),
        email: booking.tasker.email,
      },
      status: booking.status,
      displayStatus: booking.status === 'confirmed' ? 'accepted' : booking.status,
      payment: { status: booking.paymentStatus },
      amount: {
        amount: booking.totalChargedAmount === null ? estimatedTotal : money(booking.totalChargedAmount),
        currency: booking.paymentCurrency,
        settled: booking.totalChargedAmount !== null,
      },
      activeDisputes: booking.complaints.length,
      highestDisputePriority: booking.complaints.some((item: { priority: string }) => item.priority === 'urgent')
        ? 'urgent'
        : booking.complaints.some((item: { priority: string }) => item.priority === 'high')
          ? 'high'
          : booking.complaints.length
            ? 'normal'
            : null,
      createdAt: booking.createdAt.toISOString(),
    };
  }

  private availableActions(status: string, paymentStatus: string, complaints: Array<{ status: string }>): string[] {
    const hasActiveDispute = complaints.some((complaint) => ACTIVE_DISPUTE_STATUSES.includes(complaint.status as never));
    if (
      ['pending', 'confirmed', 'en_route', 'arrived'].includes(status) &&
      !hasActiveDispute &&
      ![PAYMENT_STATUS.Paid, PAYMENT_STATUS.PartiallyRefunded, PAYMENT_STATUS.Refunded].includes(paymentStatus as never)
    ) {
      return ['cancel'];
    }
    return [];
  }

  private disputeDisplayId(id: string): string {
    return `DSP-${id.slice(-6).toUpperCase()}`;
  }
}
