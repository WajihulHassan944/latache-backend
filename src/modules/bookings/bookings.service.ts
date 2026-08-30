import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../common/enums/user-role.enum';
import { dateOnlyFromDate, dateOnlyToDate, isFutureDate } from '../../common/utils/date.util';
import { formatLocation } from '../../common/utils/location.util';
import { normalizePagination } from '../../common/utils/pagination.util';
import { parseTimeToMinutes } from '../../common/utils/time.util';
import { hasUserRole } from '../../common/utils/user-role.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PAYMENT_SOURCE, PAYMENT_STATUS } from '../payments/payments.constants';
import { PaymentsService } from '../payments/payments.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import { TaskerFinanceService } from '../tasker-finance/tasker-finance.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { DisputeLifecycleService } from '../disputes/dispute-lifecycle.service';
import { ReferralsService } from '../referrals/services/referrals.service';
import { AppCacheService, CacheNamespace } from '../../infrastructure/redis/app-cache.service';
import type { AddComplaintEvidenceDto, FileComplaintDto } from './dto/file-complaint.dto';
import type {
  ListParticipantDisputesQueryDto,
  ParticipantDisputeActionDto,
  SubmitDisputeSatisfactionDto,
} from './dto/participant-disputes.dto';
import { BookingsRepository } from './bookings.repository';
import {
  BookingQuoteDto,
  CancelBookingDto,
  ExtendBookingDto,
  ListUnifiedBookingsQueryDto,
  RescheduleBookingDto,
  UpdateBookingBillingDto,
} from './dto/booking-actions.dto';
import { BookTaskerDto } from './dto/book-tasker.dto';

const BOOKED = ['pending', 'confirmed'];
const ONGOING = ['en_route', 'arrived', 'in_progress', 'awaiting_customer_approval'];
const HISTORY = ['completed', 'cancelled'];
const ACTIVE = [...BOOKED, ...ONGOING];
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const uniqueEvidenceByPublicId = <T extends { publicId: string }>(items: T[]): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.publicId)) return false;
    seen.add(item.publicId);
    return true;
  });
};

const BOOKING_INCLUDE = {
  service: true,
  serviceOption: true,
  customer: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
      phoneCountryCode: true,
      phoneNumber: true,
      rating: true,
    },
  },
  tasker: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
      phoneCountryCode: true,
      phoneNumber: true,
      rating: true,
      reviewsCount: true,
      completedTasks: true,
      isElite: true,
    },
  },
  workSession: true,
  latestLocation: true,
  _count: { select: { messages: true, complaints: true, reviews: true } },
} as const;

type UnifiedBookingWithRelations = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

const PARTICIPANT_DISPUTE_RESOLUTION_STATUSES: string[] = [
  'applied',
  'proposed',
  'accepted',
  'rejected',
];

const PARTICIPANT_DISPUTE_INCLUDE = {
  booking: {
    select: {
      id: true,
      customerId: true,
      taskerId: true,
      status: true,
      paymentStatus: true,
      bookingDate: true,
      startTime: true,
      endTime: true,
      service: { select: { id: true, name: true, slug: true, icon: true } },
    },
  },
  evidenceRequests: { orderBy: { createdAt: 'desc' as const } },
  evidences: { orderBy: { createdAt: 'desc' as const } },
  resolutions: {
    where: { status: { in: PARTICIPANT_DISPUTE_RESOLUTION_STATUSES } },
    orderBy: { createdAt: 'desc' as const },
  },
  participantActions: { orderBy: { createdAt: 'desc' as const } },
  comments: {
    orderBy: { createdAt: 'asc' as const },
    include: { author: { select: { id: true, role: true, firstName: true, lastName: true } } },
  },
  satisfactionSurveys: true,
} as const;

type ParticipantDisputeRow = Prisma.TaskComplaintGetPayload<{
  include: typeof PARTICIPANT_DISPUTE_INCLUDE;
}>;

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);
  private readonly minimumBillableMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: BookingsRepository,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly realtime: RealtimeOutboxService,
    private readonly taskerFinance: TaskerFinanceService,
    private readonly audit: AdminAuditService,
    private readonly disputes: DisputeLifecycleService,
    private readonly referrals: ReferralsService,
    private readonly cache: AppCacheService,
  ) {
    this.minimumBillableMinutes = config.get<number>('payments.minimumBillableMinutes', 120);
  }

  async quote(dto: BookingQuoteDto) {
    if (!isFutureDate(dto.date)) throw new BadRequestException('date must be after today');
    const context = await this.loadQuoteContext(
      dto.taskerId,
      dto.serviceSlug,
      dto.serviceOptionId,
      dto.date,
      dto.time,
    );
    const currency = await this.platformSettings.currencyContext();
    return this.quoteView(
      this.platformSettings.convertUsdAmount(Number(context.taskerService.hourlyRate), currency),
      context.slot.startTime,
      context.slot.endTime,
      dto.tipAmount ?? 0,
      dto.donationAmount ?? 0,
      context.service,
      context.option,
      context.tasker,
      dateOnlyToDate(dto.date),
      currency.code,
    );
  }

  async book(customerId: number, dto: BookTaskerDto) {
    if (customerId === dto.taskerId) {
      throw new ForbiddenException({ code: 'SELF_BOOKING_FORBIDDEN', message: 'A user cannot book their own Tasker profile' });
    }
    if (!isFutureDate(dto.date)) throw new BadRequestException('date must be after today');
    // Enforce configured booking-policy limits even when a client skips the quote endpoint.
    // Availability is re-read and locked again inside the booking transaction.
    const preflight = await this.loadQuoteContext(
      dto.taskerId,
      dto.serviceSlug,
      dto.serviceOptionId,
      dto.date,
      dto.time,
    );
    const preflightStart = parseTimeToMinutes(preflight.slot.startTime) ?? 0;
    const preflightEnd = parseTimeToMinutes(preflight.slot.endTime) ?? preflightStart;
    await this.platformSettings.assertBookingRules({
      bookingDate: dateOnlyToDate(dto.date),
      startTime: preflight.slot.startTime,
      slotMinutes: Math.max(1, preflightEnd - preflightStart),
    });
    const paymentSource = dto.paymentSource ?? PAYMENT_SOURCE.Stripe;
    if (paymentSource === PAYMENT_SOURCE.Cash) {
      await this.taskerFinance.assertCashBookingAllowed(dto.taskerId);
    }
    let stripePaymentMethodId: string | null = null;
    if (paymentSource === PAYMENT_SOURCE.Stripe) {
      stripePaymentMethodId =
        dto.stripePaymentMethodId ?? (await this.payments.defaultPaymentMethod(customerId));
      if (!stripePaymentMethodId) {
        throw new BadRequestException('Save or select a Stripe payment method before booking');
      }
      await this.payments.assertPaymentMethodOwnedByCustomer(customerId, stripePaymentMethodId);
    }

    try {
      const booking = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "Users"
          WHERE "id" IN (${customerId}, ${dto.taskerId})
          ORDER BY "id" FOR UPDATE
        `;
        const customer = await transaction.user.findUnique({ where: { id: customerId } });
        if (!customer) throw new NotFoundException('User not found');
        if (!hasUserRole(customer, UserRole.Customer))
          throw new ForbiddenException('Only customers can create bookings');
        const customerProfile = await transaction.customerProfile.findUnique({ where: { userId: customerId } });
        if (!customerProfile || customerProfile.status !== 'active' || customer.accountStatus !== 'active')
          throw new ForbiddenException('Customer profile is not active');

        const context = await this.loadQuoteContext(
          dto.taskerId,
          dto.serviceSlug,
          dto.serviceOptionId,
          dto.date,
          dto.time,
          transaction,
        );
        const currency = await this.platformSettings.currencyContext(transaction);
        const bookingHourlyRate = this.platformSettings.convertUsdAmount(
          Number(context.taskerService.hourlyRate),
          currency,
        );
        if (!(await this.repository.claimSlot(context.slot.id, transaction))) {
          throw new ConflictException('Requested slot has already been booked');
        }
        const start = parseTimeToMinutes(context.slot.startTime) ?? 0;
        const end = parseTimeToMinutes(context.slot.endTime) ?? start;
        const estimatedDurationMinutes = Math.max(1, end - start);
        const created = await transaction.booking.create({
          data: {
            customerId,
            taskerId: context.tasker.id,
            serviceId: context.service.id,
            serviceOptionId: context.option?.id ?? null,
            availabilityId: context.slot.id,
            hourlyRate: bookingHourlyRate.toFixed(2),
            bookingDate: dateOnlyToDate(dto.date),
            startTime: context.slot.startTime,
            endTime: context.slot.endTime,
            venueAddress: dto.bookingDetails.venueAddress,
            apartmentSuite: dto.bookingDetails.apartmentSuite || null,
            description: dto.bookingDetails.description,
            attachments: dto.bookingDetails.attachments?.length
              ? (dto.bookingDetails.attachments as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            locationLabel: dto.location.label,
            locationLat: dto.location.lat,
            locationLng: dto.location.lng,
            locationCity: dto.location.city ?? null,
            locationArea: dto.location.area ?? null,
            status: 'pending',
            estimatedDurationMinutes,
            paymentSource,
            paymentStatus: PAYMENT_STATUS.Ready,
            paymentCurrency: currency.code,
            workVerificationRequired: true,
            stripePaymentMethodId,
            tipAmount: money(dto.tipAmount ?? 0).toFixed(2),
            donationAmount: money(dto.donationAmount ?? 0).toFixed(2),
            donationDropoffRequested: dto.donationDropoffRequested ?? false,
          },
          include: BOOKING_INCLUDE,
        });
        await this.notifications.create(
          context.tasker.id,
          {
            category: 'tasks',
            type: 'booking_requested',
            title: 'New booking request',
            body: `A customer requested ${context.service.name ?? 'a service'} for ${dto.date} at ${context.slot.startTime}.`,
            entityType: 'booking',
            entityId: String(created.id),
          },
          transaction,
        );
        await this.enqueueBookingUpdate(created.id, 'pending', 'booking_created', transaction);
        return created;
      });
      return this.serialize(booking, customerId);
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002') || hasPrismaErrorCode(error, 'P2034')) {
        throw new ConflictException('Requested slot has already been booked');
      }
      throw error;
    }
  }

  async list(user: User, query: ListUnifiedBookingsQueryDto) {
    this.assertDashboardRole(user);
    const bucket = query.bucket ?? 'booked';
    const statuses = bucket === 'booked' ? BOOKED : bucket === 'ongoing' ? ONGOING : HISTORY;
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const where: Prisma.BookingWhereInput = {
      ...(user.role === UserRole.Customer ? { customerId: user.id } : { taskerId: user.id }),
      status: { in: statuses },
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: BOOKING_INCLUDE,
        orderBy:
          bucket === 'history'
            ? [{ bookingDate: 'desc' }, { startTime: 'desc' }]
            : [{ bookingDate: 'asc' }, { startTime: 'asc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);
    return {
      bucket,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => this.serialize(row, user.id)),
    };
  }

  async get(user: User, bookingId: number) {
    this.assertDashboardRole(user);
    const booking = await this.findParticipantBooking(user, bookingId);
    return this.serialize(booking, user.id);
  }

  async next(user: User) {
    this.assertDashboardRole(user);
    const today = new Date();
    const booking = await this.prisma.booking.findFirst({
      where: {
        ...(user.role === UserRole.Customer ? { customerId: user.id } : { taskerId: user.id }),
        status: { in: ACTIVE },
        bookingDate: {
          gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())),
        },
      },
      include: BOOKING_INCLUDE,
      orderBy: [{ bookingDate: 'asc' }, { startTime: 'asc' }],
    });
    return booking ? this.serialize(booking, user.id) : null;
  }

  async cancelCustomer(customerId: number, bookingId: number, dto: CancelBookingDto) {
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findFirst({ where: { id: bookingId, customerId } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (
        ['in_progress', 'awaiting_customer_approval', 'completed', 'cancelled'].includes(
          booking.status,
        )
      ) {
        throw new ConflictException('This booking can no longer be cancelled by the customer');
      }
      await transaction.userAvailability.updateMany({
        where: { id: booking.availabilityId },
        data: { isBooked: false },
      });
      await this.referrals.releaseCustomerDiscountReservation(
        transaction,
        bookingId,
        `Customer cancelled booking: ${dto.reason}`,
      );
      const row = await transaction.booking.update({
        where: { id: bookingId },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledByRole: 'customer',
          cancellationReason: dto.reason,
        },
        include: BOOKING_INCLUDE,
      });
      await this.notifications.create(
        booking.taskerId,
        {
          category: 'tasks',
          type: 'booking_cancelled_by_customer',
          title: 'Booking cancelled',
          body: 'The customer cancelled this booking.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      await this.enqueueBookingUpdate(bookingId, 'cancelled', 'customer_cancelled', transaction);
      return row;
    });
    return this.serialize(updated, customerId);
  }

  async reschedule(customerId: number, bookingId: number, dto: RescheduleBookingDto) {
    if (!isFutureDate(dto.date)) throw new BadRequestException('date must be after today');
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findFirst({ where: { id: bookingId, customerId } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (!['pending', 'confirmed'].includes(booking.status)) {
        throw new ConflictException('Only pending or confirmed bookings can be rescheduled');
      }
      const slots = await this.repository.findOpenSlotsForDate(
        booking.taskerId,
        dto.date,
        transaction,
      );
      const requested = parseTimeToMinutes(dto.time);
      const slot = slots.find((item) => parseTimeToMinutes(item.startTime) === requested);
      if (!slot || requested === null)
        throw new ConflictException('Requested date/time is unavailable');
      if (!(await this.repository.claimSlot(slot.id, transaction)))
        throw new ConflictException('Requested slot has already been booked');
      await transaction.userAvailability.updateMany({
        where: { id: booking.availabilityId },
        data: { isBooked: false },
      });
      const start = parseTimeToMinutes(slot.startTime) ?? 0;
      const end = parseTimeToMinutes(slot.endTime) ?? start;
      const row = await transaction.booking.update({
        where: { id: bookingId },
        data: {
          availabilityId: slot.id,
          bookingDate: dateOnlyToDate(dto.date),
          startTime: slot.startTime,
          endTime: slot.endTime,
          estimatedDurationMinutes: Math.max(1, end - start),
          rescheduledAt: new Date(),
          status: 'pending',
          confirmedAt: null,
        },
        include: BOOKING_INCLUDE,
      });
      await this.notifications.create(
        booking.taskerId,
        {
          category: 'tasks',
          type: 'booking_rescheduled',
          title: 'Booking rescheduled',
          body: `The customer requested ${dto.date} at ${slot.startTime}. Please confirm the new time.`,
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      await this.enqueueBookingUpdate(bookingId, 'pending', 'customer_rescheduled', transaction);
      return row;
    });
    return this.serialize(updated, customerId);
  }

  async extend(user: User, bookingId: number, dto: ExtendBookingDto) {
    if (![UserRole.Customer, UserRole.Tasker].includes(user.role as UserRole)) {
      throw new ForbiddenException('Only booking participants can extend task time');
    }
    const row = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findUnique({ where: { id: bookingId } });
      if (!booking) throw new NotFoundException('Booking not found');

      const isCustomer = user.role === UserRole.Customer && booking.customerId === user.id;
      const isTasker = user.role === UserRole.Tasker && booking.taskerId === user.id;
      if (!isCustomer && !isTasker) throw new NotFoundException('Booking not found');
      if (booking.status !== 'in_progress') {
        throw new ConflictException(
          'Additional time can be added only while the task is in progress',
        );
      }

      const updated = await transaction.booking.update({
        where: { id: bookingId },
        data: { extensionMinutes: { increment: dto.minutes } },
      });

      const otherUserId = isCustomer ? booking.taskerId : booking.customerId;
      await this.notifications.create(
        otherUserId,
        {
          category: 'tasks',
          type: 'task_time_extended',
          title: 'Task time extended',
          body: `${dto.minutes} additional minutes were added by the ${isCustomer ? 'Customer' : 'Tasker'}.`,
          entityType: 'booking',
          entityId: String(bookingId),
          metadata: {
            addedByRole: user.role,
            addedMinutes: dto.minutes,
            extensionMinutes: updated.extensionMinutes,
          },
        },
        transaction,
      );
      await this.audit.record(
        {
          actorId: user.id,
          targetUserId: otherUserId,
          action: 'booking_duration_extended',
          entityType: 'booking',
          entityId: bookingId,
          metadata: {
            actorRole: user.role,
            addedMinutes: dto.minutes,
            extensionMinutes: updated.extensionMinutes,
          },
        },
        transaction,
      );
      await this.enqueueBookingUpdate(bookingId, booking.status, 'duration_extended', transaction, {
        extensionMinutes: updated.extensionMinutes,
        addedByRole: user.role,
      });
      return updated;
    });
    return {
      bookingId: String(bookingId),
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      extensionMinutes: row.extensionMinutes,
      authorizedDurationMinutes: row.estimatedDurationMinutes + row.extensionMinutes,
    };
  }

  async completeByCustomer(customerId: number, bookingId: number): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ id: number }>>`
        SELECT "id" FROM "Bookings"
        WHERE "id" = ${bookingId} AND "customerId" = ${customerId}
        FOR UPDATE
      `;
      if (rows.length === 0) throw new NotFoundException('Booking not found');

      const booking = await transaction.booking.findUniqueOrThrow({
        where: { id: bookingId },
      });
      if (booking.status === 'completed') return;
      if (!['in_progress', 'awaiting_customer_approval'].includes(booking.status)) {
        throw new ConflictException(
          'Only an in-progress task or submitted completion can be approved',
        );
      }
      if (booking.workVerificationRequired && !booking.completionProofAt) {
        throw new ConflictException('The Tasker must attach completed-work proof before the Customer can finish the task');
      }

      const session = await transaction.taskWorkSession.findUnique({
        where: { bookingId },
      });
      if (!session || session.status !== 'stopped') {
        throw new ConflictException('The task timer must be stopped before completion');
      }

      const activeDispute = await transaction.taskComplaint.count({
        where: {
          bookingId,
          status: { in: ['open', 'under_investigation', 'escalated'] },
        },
      });
      if (activeDispute > 0) {
        throw new ConflictException('Resolve or dismiss the active dispute before approval');
      }

      const now = new Date();
      await transaction.booking.update({
        where: { id: bookingId },
        data: {
          status: 'completed',
          completionSubmittedAt:
            booking.completionSubmittedAt ?? booking.completionProofAt ?? now,
          completionApprovalDueAt: booking.completionApprovalDueAt,
          completionApprovedAt: now,
          completionApprovedByRole: 'customer',
          completionVerifiedAt: booking.workVerificationRequired ? now : booking.completionVerifiedAt,
          completionVerifiedByRole: booking.workVerificationRequired
            ? 'customer_fallback'
            : booking.completionVerifiedByRole,
          taskCompletedAt: now,
        },
      });
      await transaction.user.update({
        where: { id: booking.taskerId },
        data: { completedTasks: { increment: 1 } },
      });
      await this.notifications.create(
        booking.taskerId,
        {
          category: 'tasks',
          type: 'task_completed_by_customer',
          title: 'Task completed',
          body: 'The customer confirmed that the task is complete.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      await this.audit.record(
        {
          actorId: customerId,
          targetUserId: booking.taskerId,
          action: 'booking_completion_approved',
          entityType: 'booking',
          entityId: bookingId,
          metadata: { approvedByRole: 'customer', approvedAt: now.toISOString() },
        },
        transaction,
      );
      await this.enqueueBookingUpdate(bookingId, 'completed', 'customer_completed', transaction);
    });
    await this.cache.invalidate(CacheNamespace.ManagedContent);
  }

  async autoCompleteDueBookings(): Promise<{
    examined: number;
    completed: number;
    paymentFinalized: number;
    blockedByDispute: number;
  }> {
    const now = new Date();
    const batchSize = this.config.get<number>('bookingCompletion.batchSize', 100);
    const candidates = await this.prisma.booking.findMany({
      where: {
        workVerificationRequired: false,
        OR: [
          {
            status: 'awaiting_customer_approval',
            completionApprovalDueAt: { lte: now },
          },
          {
            status: 'completed',
            completionAutoApprovedAt: { not: null },
            paidAt: null,
            paymentStatus: { in: [PAYMENT_STATUS.Ready, PAYMENT_STATUS.Processing] },
          },
        ],
      },
      select: { id: true },
      orderBy: [{ completionApprovalDueAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });

    let completed = 0;
    let paymentFinalized = 0;
    let blockedByDispute = 0;
    let firstFailure: unknown;

    for (const candidate of candidates) {
      const outcome = await this.autoApproveOne(candidate.id, now);
      if (outcome.blockedByDispute) {
        blockedByDispute += 1;
        continue;
      }
      if (!outcome.finalizePayment) continue;
      if (outcome.completed) completed += 1;
      try {
        await this.payments.finalizeCompletedBooking(candidate.id);
        paymentFinalized += 1;
      } catch (error) {
        firstFailure ??= error;
        this.logger.error(
          JSON.stringify({
            event: 'auto_completion_payment_failed',
            bookingId: candidate.id,
            error: error instanceof Error ? error.message.slice(0, 500) : String(error),
          }),
        );
      }
    }

    if (firstFailure) throw firstFailure;
    return { examined: candidates.length, completed, paymentFinalized, blockedByDispute };
  }

  private async autoApproveOne(
    bookingId: number,
    now: Date,
  ): Promise<{ completed: boolean; finalizePayment: boolean; blockedByDispute: boolean }> {
    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findUnique({
        where: { id: bookingId },
        include: {
          complaints: {
            where: { status: { in: ['open', 'under_investigation', 'escalated'] } },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!booking) {
        return { completed: false, finalizePayment: false, blockedByDispute: false };
      }
      if (booking.workVerificationRequired) {
        return { completed: false, finalizePayment: false, blockedByDispute: false };
      }
      if (booking.complaints.length > 0 || booking.paymentStatus === PAYMENT_STATUS.OnHoldDispute) {
        return { completed: false, finalizePayment: false, blockedByDispute: true };
      }
      if (
        booking.status === 'completed' &&
        booking.completionAutoApprovedAt &&
        !booking.paidAt &&
        (booking.paymentStatus === PAYMENT_STATUS.Ready ||
          booking.paymentStatus === PAYMENT_STATUS.Processing)
      ) {
        return { completed: false, finalizePayment: true, blockedByDispute: false };
      }
      if (
        booking.status !== 'awaiting_customer_approval' ||
        !booking.completionApprovalDueAt ||
        booking.completionApprovalDueAt > now
      ) {
        return { completed: false, finalizePayment: false, blockedByDispute: false };
      }
      const approvalDueAt = booking.completionApprovalDueAt;

      await transaction.booking.update({
        where: { id: bookingId },
        data: {
          status: 'completed',
          completionApprovedAt: now,
          completionApprovedByRole: 'system',
          completionAutoApprovedAt: now,
          taskCompletedAt: now,
        },
      });
      await transaction.user.update({
        where: { id: booking.taskerId },
        data: { completedTasks: { increment: 1 } },
      });
      await this.notifications.create(
        booking.taskerId,
        {
          category: 'tasks',
          type: 'task_completion_auto_approved',
          title: 'Task completion approved',
          body: 'The customer review window elapsed without a dispute, so the task was approved.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'task_completion_auto_approved',
          title: 'Task automatically completed',
          body: 'The review window elapsed without a dispute, so payment finalization has started.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      await this.audit.record(
        {
          targetUserId: booking.taskerId,
          action: 'booking_completion_auto_approved',
          entityType: 'booking',
          entityId: bookingId,
          reason: 'Configured customer review window elapsed without an active dispute',
          metadata: {
            submittedAt: booking.completionSubmittedAt?.toISOString() ?? null,
            approvalDueAt: approvalDueAt.toISOString(),
            approvedAt: now.toISOString(),
          },
        },
        transaction,
      );
      await this.enqueueBookingUpdate(
        bookingId,
        'completed',
        'completion_auto_approved',
        transaction,
        {
          approvedAt: now.toISOString(),
          approvedByRole: 'system',
        },
      );
      return { completed: true, finalizePayment: true, blockedByDispute: false };
    });
    if (result.completed) await this.cache.invalidate(CacheNamespace.ManagedContent);
    return result;
  }

  async updateBilling(customerId: number, bookingId: number, dto: UpdateBookingBillingDto) {
    if (
      dto.tipAmount === undefined &&
      dto.donationAmount === undefined &&
      dto.donationDropoffRequested === undefined
    ) {
      throw new BadRequestException(
        'Provide tipAmount, donationAmount, or donationDropoffRequested',
      );
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findFirst({ where: { id: bookingId, customerId } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (
        [PAYMENT_STATUS.Paid, PAYMENT_STATUS.CashConfirmed].includes(booking.paymentStatus as never)
      ) {
        throw new ConflictException('A paid booking can no longer change tip or donation');
      }
      const row = await transaction.booking.update({
        where: { id: bookingId },
        data: {
          ...(dto.tipAmount !== undefined ? { tipAmount: money(dto.tipAmount).toFixed(2) } : {}),
          ...(dto.donationAmount !== undefined
            ? { donationAmount: money(dto.donationAmount).toFixed(2) }
            : {}),
          ...(dto.donationDropoffRequested !== undefined
            ? { donationDropoffRequested: dto.donationDropoffRequested }
            : {}),
        },
      });
      await this.enqueueBookingUpdate(bookingId, row.status, 'billing_updated', transaction, {
        tipAmount: Number(row.tipAmount),
        donationAmount: Number(row.donationAmount),
        donationDropoffRequested: row.donationDropoffRequested,
      });
      return row;
    });
    return {
      bookingId: String(bookingId),
      tipAmount: Number(updated.tipAmount),
      donationAmount: Number(updated.donationAmount),
      donationDropoffRequested: updated.donationDropoffRequested,
      currency: updated.paymentCurrency,
      paymentStatus: updated.paymentStatus,
    };
  }

  async navigation(user: User, bookingId: number) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, ...this.participantBookingScope(user) },
      include: { latestLocation: true, customer: true, tasker: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return {
      bookingId: String(bookingId),
      status: booking.status,
      destination: {
        label: booking.locationLabel,
        lat: Number(booking.locationLat),
        lng: Number(booking.locationLng),
        venueAddress: booking.venueAddress,
      },
      latestTaskerLocation: booking.latestLocation
        ? {
            lat: Number(booking.latestLocation.lat),
            lng: Number(booking.latestLocation.lng),
            accuracyM:
              booking.latestLocation.accuracyM === null
                ? null
                : Number(booking.latestLocation.accuracyM),
            headingDeg:
              booking.latestLocation.headingDeg === null
                ? null
                : Number(booking.latestLocation.headingDeg),
            capturedAt: booking.latestLocation.capturedAt.toISOString(),
          }
        : null,
      routeMetrics: null,
      routeMetricsReason:
        'Distance, ETA and route geometry require a real maps/routing provider and are intentionally not fabricated.',
    };
  }

  async timer(user: User, bookingId: number) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, ...this.participantBookingScope(user) },
      include: { workSession: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const session = booking.workSession;
    if (!session)
      return {
        bookingId: String(bookingId),
        status: 'not_started',
        elapsedSeconds: 0,
        startedAt: null,
        pausedAt: null,
        stoppedAt: null,
        notes: '',
      };
    const endpoint = session.stoppedAt ?? session.pausedAt ?? new Date();
    const elapsedSeconds = Math.max(
      0,
      Math.floor((endpoint.getTime() - session.startedAt.getTime()) / 1000) -
        session.accumulatedPausedSecs,
    );
    return {
      bookingId: String(bookingId),
      status: session.status,
      elapsedSeconds,
      startedAt: session.startedAt.toISOString(),
      pausedAt: session.pausedAt?.toISOString() ?? null,
      stoppedAt: session.stoppedAt?.toISOString() ?? null,
      notes: session.notes ?? '',
      authorizedDurationMinutes: booking.estimatedDurationMinutes + booking.extensionMinutes,
    };
  }

  async listUserDisputes(user: User, query: ListParticipantDisputesQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.TaskComplaintWhereInput = {
      booking: this.participantBookingScope(user),
      ...(query.bookingId ? { bookingId: query.bookingId } : {}),
      ...(query.status && query.status !== 'all' ? { status: query.status } : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.taskComplaint.findMany({
        where,
        include: PARTICIPANT_DISPUTE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.taskComplaint.count({ where }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => this.participantDisputeView(row, user.id)),
    };
  }

  async getUserDispute(user: User, disputeId: string) {
    const row = await this.prisma.taskComplaint.findFirst({
      where: {
        id: disputeId,
        booking: this.participantBookingScope(user),
      },
      include: PARTICIPANT_DISPUTE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Dispute not found');
    return this.participantDisputeView(row, user.id);
  }

  async addUserDisputeEvidence(user: User, disputeId: string, dto: AddComplaintEvidenceDto) {
    const complaint = await this.prisma.taskComplaint.findFirst({
      where: {
        id: disputeId,
        booking: this.participantBookingScope(user),
      },
      select: { bookingId: true },
    });
    if (!complaint) throw new NotFoundException('Dispute not found');
    return this.addComplaintEvidence(user, complaint.bookingId, disputeId, dto);
  }

  async listComplaints(user: User, bookingId: number) {
    const participant = await this.prisma.booking.findFirst({
      where: { id: bookingId, ...this.participantBookingScope(user) },
      select: { id: true, customerId: true, taskerId: true },
    });
    if (!participant) throw new NotFoundException('Booking not found');
    const participantRole = user.role as 'customer' | 'tasker';

    const complaints = await this.prisma.taskComplaint.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'desc' },
      include: {
        evidenceRequests: {
          where: { requestedFrom: { in: [participantRole, 'both'] } },
          orderBy: { createdAt: 'desc' },
        },
        evidences: {
          where: { uploadedById: user.id },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    return complaints.map((complaint) => ({
      id: complaint.id,
      bookingId: String(bookingId),
      category: complaint.category,
      description: complaint.description,
      status: complaint.status,
      priority: complaint.priority,
      filedByCurrentUser: complaint.filedById === user.id,
      initialAttachments:
        complaint.filedById === user.id &&
        !complaint.evidences.some((evidence) => evidence.source === 'initial_complaint') &&
        Array.isArray(complaint.attachments)
          ? complaint.attachments
          : [],
      evidenceReview: {
        status: complaint.evidenceReviewStatus,
        awaitingResponseFrom: complaint.awaitingResponseFrom,
        responseDueAt: complaint.responseDueAt?.toISOString() ?? null,
      },
      evidenceRequests: complaint.evidenceRequests.map((request) => ({
        id: request.id,
        message: request.message,
        requestedFrom: request.requestedFrom,
        status: request.status,
        dueAt: request.dueAt?.toISOString() ?? null,
        fulfilledAt: request.fulfilledAt?.toISOString() ?? null,
        createdAt: request.createdAt.toISOString(),
      })),
      myEvidence: complaint.evidences.map((evidence) => ({
        id: evidence.id,
        name: evidence.name,
        publicId: evidence.publicId,
        secureUrl: evidence.secureUrl,
        resourceType: evidence.resourceType,
        bytes: evidence.bytes,
        mimeType: evidence.mimeType,
        source: evidence.source,
        reviewedAt: evidence.reviewedAt?.toISOString() ?? null,
        createdAt: evidence.createdAt.toISOString(),
      })),
      createdAt: complaint.createdAt.toISOString(),
      updatedAt: complaint.updatedAt.toISOString(),
    }));
  }

  async fileComplaint(
    user: User,
    bookingId: number,
    dto: FileComplaintDto,
    idempotencyKey?: string,
  ) {
    const verifiedAttachments = uniqueEvidenceByPublicId(
      await this.disputes.verifyEvidence(user, dto.attachments ?? []),
    );
    await this.disputes.assertIncomingEvidenceCapacity(verifiedAttachments);
    const normalizedKey = this.disputeRequestKey(idempotencyKey);

    try {
      const result = await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
        const booking = await transaction.booking.findFirst({
          where: { id: bookingId, ...this.participantBookingScope(user) },
          select: {
            id: true,
            customerId: true,
            taskerId: true,
            status: true,
            paymentStatus: true,
            completionSubmittedAt: true,
            completionApprovedAt: true,
            taskCompletedAt: true,
          },
        });
        if (!booking) throw new NotFoundException('Booking not found');
        if (booking.status === 'cancelled') {
          throw new ConflictException({
            code: 'DISPUTE_BOOKING_CANCELLED',
            message: 'A dispute cannot be filed for an inaccessible cancelled booking.',
          });
        }

        const replay = normalizedKey
          ? await transaction.taskComplaint.findFirst({
              where: { filedById: user.id, clientRequestKey: normalizedKey },
            })
          : null;
        if (replay) {
          if (replay.bookingId !== bookingId) {
            throw new ConflictException({
              code: 'DISPUTE_IDEMPOTENCY_KEY_REUSED',
              message: 'This idempotency key has already been used for another dispute request.',
            });
          }
          return { complaint: replay, replay: true };
        }

        const policy = await this.disputes.policy(transaction);
        const completionAnchor =
          booking.taskCompletedAt ?? booking.completionApprovedAt ?? booking.completionSubmittedAt;
        if (!completionAnchor) {
          throw new ConflictException({
            code: 'DISPUTE_NOT_YET_FILEABLE',
            message: 'A booking dispute can be filed only after service completion has been recorded.',
          });
        }
        const filingDeadlineAt = this.disputes.filingDeadline(completionAnchor, policy);
        if (filingDeadlineAt && filingDeadlineAt.getTime() < Date.now()) {
          throw new ConflictException({
            code: 'DISPUTE_FILING_WINDOW_CLOSED',
            message: 'The configured post-service dispute filing window has closed.',
            filingDeadlineAt: filingDeadlineAt.toISOString(),
          });
        }

        const active = await transaction.taskComplaint.findFirst({
          where: {
            bookingId,
            status: { in: ['open', 'under_investigation', 'escalated'] },
          },
          select: { id: true, status: true, filedById: true },
          orderBy: { createdAt: 'asc' },
        });
        if (active) {
          throw new ConflictException({
            code: 'ACTIVE_DISPUTE_EXISTS',
            message: 'An active dispute already exists for this booking.',
            disputeId: active.id,
            status: active.status,
          });
        }

        const participantRole = user.role as 'customer' | 'tasker';
        const priority =
          dto.category === 'safety'
            ? 'urgent'
            : ['missed_appointment', 'overcharged', 'payment'].includes(dto.category)
              ? 'high'
              : 'normal';
        const assignedAdminId = await this.disputes.selectAssignee(transaction);
        const now = new Date();
        const attachmentRows = verifiedAttachments.map((attachment) => ({
          ...attachment,
          name:
            dto.attachments?.find((input) => input.publicId === attachment.publicId)?.originalFileName?.trim() ||
            attachment.originalFileName ||
            attachment.publicId.split('/').filter(Boolean).pop() ||
            'Complaint attachment',
        }));

        const complaint = await transaction.taskComplaint.create({
          data: {
            bookingId,
            filedById: user.id,
            filedByRole: participantRole,
            category: dto.category,
            description: dto.description,
            priority,
            clientRequestKey: normalizedKey,
            activeBookingKey: `booking:${bookingId}`,
            filingDeadlineAt,
            slaDueAt: this.disputes.slaDeadline(now, policy),
            assignedAdminId,
            evidenceReviewStatus: attachmentRows.length ? 'pending' : 'not_required',
            attachments: attachmentRows.length
              ? (attachmentRows as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });

        if (attachmentRows.length) {
          await transaction.disputeEvidence.createMany({
            data: attachmentRows.map((attachment) => ({
              complaintId: complaint.id,
              uploadedById: user.id,
              uploadedByRole: participantRole,
              source: 'initial_complaint',
              name: attachment.name,
              publicId: attachment.publicId,
              secureUrl: attachment.secureUrl,
              resourceType: attachment.resourceType ?? null,
              bytes: attachment.bytes ?? null,
              mimeType: attachment.mimeType ?? null,
            })),
          });
        }

        if (
          ![
            PAYMENT_STATUS.Paid,
            PAYMENT_STATUS.CashConfirmed,
            PAYMENT_STATUS.PartiallyRefunded,
            PAYMENT_STATUS.Refunded,
            PAYMENT_STATUS.Failed,
          ].includes(booking.paymentStatus as never)
        ) {
          await transaction.booking.update({
            where: { id: bookingId },
            data: { paymentStatus: PAYMENT_STATUS.OnHoldDispute },
          });
        }
        await this.payments.blockTaskerFinanceForDispute(
          bookingId,
          `Booking dispute ${complaint.id} is active`,
          transaction,
        );
        await this.disputes.notifyParticipants(transaction, complaint.id, booking, {
          eventType: 'booking_dispute_opened',
          title: 'A booking dispute was opened',
          body: 'A dispute was submitted for this booking and the case is now under review.',
          eventKey: 'opened',
          metadata: { bookingId, priority, assignedAdminId },
        });
        if (assignedAdminId) {
          await this.disputes.notifyUser(transaction, complaint.id, assignedAdminId, {
            eventType: 'dispute_assignment_updated',
            title: 'New dispute assigned',
            body: 'A newly opened booking dispute was automatically assigned to you.',
            eventKey: 'auto-assigned',
            metadata: { bookingId, priority },
          });
        }
        await this.audit.record(
          {
            actorId: user.id,
            action: 'dispute_opened',
            entityType: 'dispute',
            entityId: complaint.id,
            metadata: {
              bookingId,
              priority,
              assignedAdminId,
              clientRequestKey: normalizedKey,
              filingDeadlineAt: filingDeadlineAt?.toISOString() ?? null,
            },
          },
          transaction,
        );
        await this.enqueueBookingUpdate(bookingId, booking.status, 'dispute_opened', transaction, {
          disputeId: complaint.id,
          priority,
        });
        return { complaint, replay: false };
      });
      return this.openedDisputeView(result.complaint, bookingId, result.replay);
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        const replay = normalizedKey
          ? await this.prisma.taskComplaint.findFirst({
              where: { filedById: user.id, clientRequestKey: normalizedKey },
            })
          : null;
        if (replay?.bookingId === bookingId) return this.openedDisputeView(replay, bookingId, true);
        const active = await this.prisma.taskComplaint.findFirst({
          where: { bookingId, status: { in: ['open', 'under_investigation', 'escalated'] } },
          orderBy: { createdAt: 'asc' },
        });
        if (active) {
          throw new ConflictException({
            code: 'ACTIVE_DISPUTE_EXISTS',
            message: 'An active dispute already exists for this booking.',
            disputeId: active.id,
          });
        }
      }
      throw error;
    }
  }

  async addComplaintEvidence(
    user: User,
    bookingId: number,
    complaintId: string,
    dto: AddComplaintEvidenceDto,
  ) {
    if (!dto.evidence.length) {
      throw new BadRequestException('At least one evidence item is required');
    }
    const verified = uniqueEvidenceByPublicId(await this.disputes.verifyEvidence(user, dto.evidence));
    const evidenceItems = verified.map((evidence) => ({
      ...evidence,
      name:
        dto.evidence.find((item) => item.publicId === evidence.publicId)?.name?.trim() ||
        evidence.originalFileName ||
        'Dispute evidence',
    }));

    const result = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findFirst({
        where: { id: bookingId, ...this.participantBookingScope(user) },
        select: { id: true, customerId: true, taskerId: true, status: true },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      const participantRole = user.role as 'customer' | 'tasker';

      await transaction.$queryRaw`
        SELECT "id" FROM "TaskComplaints"
        WHERE "id" = ${complaintId} AND "bookingId" = ${bookingId}
        FOR UPDATE
      `;
      const complaint = await transaction.taskComplaint.findFirst({
        where: { id: complaintId, bookingId },
      });
      if (!complaint) throw new NotFoundException('Dispute not found');
      if (!this.disputes.isActive(complaint.status)) {
        throw new ConflictException('Evidence cannot be added to a closed dispute');
      }
      const existingEvidence = await transaction.disputeEvidence.findMany({
        where: {
          complaintId,
          publicId: { in: evidenceItems.map((item) => item.publicId) },
        },
        select: { publicId: true },
      });
      const existingPublicIds = new Set(
        existingEvidence.map((item) => item.publicId).filter((value): value is string => Boolean(value)),
      );
      const newEvidenceItems = evidenceItems.filter((item) => !existingPublicIds.has(item.publicId));
      if (newEvidenceItems.length > 0) {
        await this.disputes.assertEvidenceCapacity(complaintId, newEvidenceItems, transaction);
        await transaction.disputeEvidence.createMany({
          data: newEvidenceItems.map((evidence) => ({
            complaintId,
            uploadedById: user.id,
            uploadedByRole: participantRole,
            source: 'requested_evidence',
            name: evidence.name,
            publicId: evidence.publicId,
            secureUrl: evidence.secureUrl,
            resourceType: evidence.resourceType ?? null,
            bytes: evidence.bytes ?? null,
            mimeType: evidence.mimeType ?? null,
          })),
        });
      }

      const now = new Date();
      if (newEvidenceItems.length > 0) {
        await transaction.disputeEvidenceRequest.updateMany({
          where: {
            complaintId,
            status: 'pending',
            requestedFrom: participantRole,
          },
          data: { status: 'fulfilled', fulfilledAt: now },
        });
        await transaction.disputeEvidenceRequest.updateMany({
          where: {
            complaintId,
            status: 'overdue',
            requestedFrom: participantRole,
          },
          data: { status: 'fulfilled_late', fulfilledAt: now },
        });

        // Compatibility for legacy pre-normalized "both" requests.
        const otherRole = participantRole === 'customer' ? 'tasker' : 'customer';
        await transaction.disputeEvidenceRequest.updateMany({
          where: { complaintId, status: { in: ['pending', 'overdue'] }, requestedFrom: 'both' },
          data: { requestedFrom: otherRole },
        });
      }

      const pendingRows = await transaction.disputeEvidenceRequest.findMany({
        where: { complaintId, status: { in: ['pending', 'overdue'] } },
        select: { requestedFrom: true, dueAt: true },
        orderBy: { createdAt: 'asc' },
      });
      const pendingRoles = new Set(pendingRows.map((request) => request.requestedFrom));
      const awaitingResponseFrom =
        pendingRoles.has('customer') && pendingRoles.has('tasker')
          ? 'both'
          : pendingRoles.has('customer')
            ? 'customer'
            : pendingRoles.has('tasker')
              ? 'tasker'
              : null;
      const responseDueAt =
        pendingRows
          .map((request) => request.dueAt)
          .filter((value): value is Date => value !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

      if (newEvidenceItems.length > 0) {
        await transaction.taskComplaint.update({
          where: { id: complaintId },
          data: {
            evidenceReviewStatus: pendingRows.length ? 'needs_more_evidence' : 'pending',
            awaitingResponseFrom,
            responseDueAt,
          },
        });
      }

      if (complaint.assignedAdminId && newEvidenceItems.length > 0) {
        await this.notifications.create(
          complaint.assignedAdminId,
          {
            category: 'tasks',
            type: 'dispute_evidence_received',
            title: 'Dispute evidence received',
            body: `${participantRole === 'customer' ? 'Customer' : 'Tasker'} submitted additional evidence.`,
            entityType: 'dispute',
            entityId: complaintId,
            metadata: { bookingId, evidenceCount: newEvidenceItems.length },
          },
          transaction,
        );
      }
      if (newEvidenceItems.length > 0) {
        await this.enqueueBookingUpdate(
          bookingId,
          booking.status,
          'dispute_evidence_submitted',
          transaction,
          {
            disputeId: complaintId,
            submittedByRole: participantRole,
            submittedCount: newEvidenceItems.length,
          },
        );
      }
      return { participantRole, pendingRequests: pendingRows.length, submittedCount: newEvidenceItems.length };
    });

    return {
      disputeId: complaintId,
      bookingId: String(bookingId),
      submittedByRole: result.participantRole,
      submittedCount: result.submittedCount,
      duplicateEvidenceIgnored: evidenceItems.length - result.submittedCount,
      pendingEvidenceRequests: result.pendingRequests,
      dispute: await this.getUserDispute(user, complaintId),
    };
  }


  async participantDisputeAction(user: User, disputeId: string, dto: ParticipantDisputeActionDto) {
    if (dto.action === 'comment') {
      const message = dto.message?.trim();
      if (!message) throw new BadRequestException('message is required for a dispute comment');
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "TaskComplaints" WHERE "id" = ${disputeId} FOR UPDATE`;
        const complaint = await transaction.taskComplaint.findUnique({
          where: { id: disputeId },
          include: { booking: true },
        });
        if (!complaint || !this.isParticipantInActiveRole(user, complaint.booking)) {
          throw new NotFoundException('Dispute not found');
        }
        const comment = await transaction.disputeComment.create({
          data: {
            complaintId: disputeId,
            authorId: user.id,
            authorRole: user.role,
            body: message,
          },
        });
        await transaction.disputeParticipantAction.create({
          data: { complaintId: disputeId, userId: user.id, userRole: user.role, action: 'comment', message },
        });
        const otherId = user.role === UserRole.Customer
          ? complaint.booking.taskerId
          : complaint.booking.customerId;
        await this.disputes.notifyUser(transaction, disputeId, otherId, {
          eventType: 'dispute_comment_added',
          title: 'New dispute comment',
          body: 'The other booking participant added a comment to the dispute.',
          eventKey: `comment:${comment.id}`,
        });
        if (complaint.assignedAdminId) {
          await this.disputes.notifyUser(transaction, disputeId, complaint.assignedAdminId, {
            eventType: 'dispute_comment_added',
            title: 'New participant dispute comment',
            body: 'A booking participant added a comment to an assigned dispute.',
            eventKey: `admin-comment:${comment.id}`,
          });
        }
      });
      return this.getUserDispute(user, disputeId);
    }

    if (dto.action === 'withdraw') {
      const result = await this.prisma.$transaction(async (transaction) => {
        const complaintRef = await transaction.taskComplaint.findUnique({
          where: { id: disputeId },
          select: { bookingId: true },
        });
        if (!complaintRef) throw new NotFoundException('Dispute not found');
        await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${complaintRef.bookingId} FOR UPDATE`;
        await transaction.$queryRaw`SELECT "id" FROM "TaskComplaints" WHERE "id" = ${disputeId} FOR UPDATE`;
        const complaint = await transaction.taskComplaint.findUnique({
          where: { id: disputeId },
          include: { booking: true },
        });
        if (!complaint || !this.isParticipantInActiveRole(user, complaint.booking)) {
          throw new NotFoundException('Dispute not found');
        }
        if (complaint.filedById !== user.id) {
          throw new ForbiddenException('Only the participant who opened the dispute can withdraw it');
        }
        if (!this.disputes.isActive(complaint.status)) {
          throw new ConflictException('Only an active dispute can be withdrawn');
        }
        const financialResolutionInProgress = await transaction.disputeResolution.findFirst({
          where: {
            complaintId: disputeId,
            status: { in: ['processing', 'processing_manual_transfer'] },
          },
          select: { id: true },
        });
        if (financialResolutionInProgress) {
          throw new ConflictException(
            'This dispute cannot be withdrawn while an approved financial resolution is processing',
          );
        }
        const now = new Date();
        await transaction.taskComplaint.update({
          where: { id: disputeId },
          data: {
            status: 'withdrawn',
            activeBookingKey: null,
            withdrawnAt: now,
            withdrawnById: user.id,
            resolvedAt: now,
            resolutionType: 'withdrawn_by_participant',
            resolutionSummary: dto.message?.trim() || 'Withdrawn by the filing participant.',
            awaitingResponseFrom: null,
            responseDueAt: null,
          },
        });
        await transaction.disputeEvidenceRequest.updateMany({
          where: { complaintId: disputeId, status: { in: ['pending', 'overdue'] } },
          data: { status: 'cancelled' },
        });
        await transaction.disputeResolution.updateMany({
          where: { complaintId: disputeId, status: 'proposed' },
          data: { status: 'cancelled' },
        });
        await transaction.disputeParticipantAction.create({
          data: {
            complaintId: disputeId,
            userId: user.id,
            userRole: user.role,
            action: 'withdraw',
            message: dto.message?.trim() || null,
          },
        });
        await this.disputes.notifyParticipants(transaction, disputeId, complaint.booking, {
          eventType: 'dispute_withdrawn',
          title: 'Booking dispute withdrawn',
          body: 'The filing participant withdrew the booking dispute.',
          eventKey: `withdraw:${now.toISOString()}`,
        });
        await this.audit.record(
          {
            actorId: user.id,
            action: 'dispute_withdrawn',
            entityType: 'dispute',
            entityId: disputeId,
            reason: dto.message?.trim(),
          },
          transaction,
        );
        return complaint.bookingId;
      });
      await this.payments.releaseDisputeHold(result);
      return this.getUserDispute(user, disputeId);
    }

    if (dto.action === 'appeal') {
      try {
        await this.prisma.$transaction(async (transaction) => {
          const complaintRef = await transaction.taskComplaint.findUnique({
            where: { id: disputeId },
            select: { bookingId: true },
          });
          if (!complaintRef) throw new NotFoundException('Dispute not found');
          await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${complaintRef.bookingId} FOR UPDATE`;
          await transaction.$queryRaw`SELECT "id" FROM "TaskComplaints" WHERE "id" = ${disputeId} FOR UPDATE`;
          const complaint = await transaction.taskComplaint.findUnique({
            where: { id: disputeId },
            include: { booking: true },
          });
          if (!complaint || !this.isParticipantInActiveRole(user, complaint.booking)) {
            throw new NotFoundException('Dispute not found');
          }
          if (!['resolved', 'dismissed'].includes(complaint.status)) {
            throw new ConflictException('Only a resolved or dismissed dispute can be appealed');
          }
          const alreadyAppealed = await transaction.disputeParticipantAction.findFirst({
            where: { complaintId: disputeId, userId: user.id, action: 'appeal' },
            select: { id: true },
          });
          if (alreadyAppealed) throw new ConflictException('You have already appealed this dispute');
          const policy = await this.disputes.policy(transaction);
          const closedAt = complaint.withdrawnAt ?? complaint.resolvedAt ?? complaint.updatedAt;
          const appealDeadline = this.disputes.appealDeadline(closedAt, policy);
          if (appealDeadline.getTime() < Date.now()) {
            throw new ConflictException({
              code: 'DISPUTE_APPEAL_WINDOW_CLOSED',
              message: 'The configured dispute appeal window has closed.',
              appealDeadlineAt: appealDeadline.toISOString(),
            });
          }
          const otherActive = await transaction.taskComplaint.findFirst({
            where: {
              bookingId: complaint.bookingId,
              id: { not: disputeId },
              status: { in: ['open', 'under_investigation', 'escalated'] },
            },
            select: { id: true },
          });
          if (otherActive) {
            throw new ConflictException({
              code: 'ACTIVE_DISPUTE_EXISTS',
              message: 'Another active dispute already exists for this booking.',
              disputeId: otherActive.id,
            });
          }
          const now = new Date();
          await transaction.taskComplaint.update({
            where: { id: disputeId },
            data: {
              status: 'under_investigation',
              activeBookingKey: `booking:${complaint.bookingId}`,
              appealCount: { increment: 1 },
              assignedAdminId: complaint.assignedAdminId ?? (await this.disputes.selectAssignee(transaction)),
              slaDueAt: this.disputes.slaDeadline(now, policy),
              slaBreachedAt: null,
              resolvedAt: null,
              resolvedById: null,
              withdrawnAt: null,
              withdrawnById: null,
              resolutionType: null,
              resolutionSummary: null,
              resolutionAmount: null,
              resolutionCurrency: null,
            },
          });
          if (
            ![
              PAYMENT_STATUS.Paid,
              PAYMENT_STATUS.CashConfirmed,
              PAYMENT_STATUS.PartiallyRefunded,
              PAYMENT_STATUS.Refunded,
              PAYMENT_STATUS.Failed,
            ].includes(complaint.booking.paymentStatus as never)
          ) {
            await transaction.booking.update({
              where: { id: complaint.bookingId },
              data: { paymentStatus: PAYMENT_STATUS.OnHoldDispute },
            });
          }
          await this.payments.blockTaskerFinanceForDispute(
            complaint.bookingId,
            `Dispute ${disputeId} was appealed`,
            transaction,
          );
          await transaction.disputeParticipantAction.create({
            data: {
              complaintId: disputeId,
              userId: user.id,
              userRole: user.role,
              action: 'appeal',
              message: dto.message?.trim() || null,
            },
          });
          await this.disputes.notifyParticipants(transaction, disputeId, complaint.booking, {
            eventType: 'dispute_appealed',
            title: 'Booking dispute appealed',
            body: 'A participant appealed the closed dispute and the case is under investigation again.',
            eventKey: `appeal:${user.id}`,
          });
          await this.audit.record(
            {
              actorId: user.id,
              action: 'dispute_appealed',
              entityType: 'dispute',
              entityId: disputeId,
              reason: dto.message?.trim(),
            },
            transaction,
          );
        });
      } catch (error) {
        if (hasPrismaErrorCode(error, 'P2002')) {
          throw new ConflictException({
            code: 'ACTIVE_DISPUTE_EXISTS',
            message: 'An active dispute already exists for this booking.',
          });
        }
        throw error;
      }
      return this.getUserDispute(user, disputeId);
    }

    if (dto.action === 'accept_proposal' || dto.action === 'reject_proposal') {
      if (!dto.resolutionId) throw new BadRequestException('resolutionId is required');
      await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "TaskComplaints" WHERE "id" = ${disputeId} FOR UPDATE`;
        const complaint = await transaction.taskComplaint.findUnique({
          where: { id: disputeId },
          include: { booking: true },
        });
        if (!complaint || !this.isParticipantInActiveRole(user, complaint.booking)) {
          throw new NotFoundException('Dispute not found');
        }
        if (!this.disputes.isActive(complaint.status)) {
          throw new ConflictException('Settlement responses require an active dispute');
        }
        const resolution = await transaction.disputeResolution.findFirst({
          where: { id: dto.resolutionId, complaintId: disputeId, status: 'proposed' },
        });
        if (!resolution) throw new NotFoundException('Active settlement proposal not found');
        if (resolution.proposalResponseDueAt && resolution.proposalResponseDueAt < new Date()) {
          throw new ConflictException('The settlement response deadline has passed');
        }
        const prior = await transaction.disputeParticipantAction.findFirst({
          where: {
            complaintId: disputeId,
            resolutionId: resolution.id,
            userId: user.id,
            action: { in: ['accept_proposal', 'reject_proposal'] },
          },
        });
        if (prior) throw new ConflictException('You already responded to this settlement proposal');
        await transaction.disputeParticipantAction.create({
          data: {
            complaintId: disputeId,
            resolutionId: resolution.id,
            userId: user.id,
            userRole: user.role,
            action: dto.action,
            message: dto.message?.trim() || null,
          },
        });
        if (dto.action === 'reject_proposal') {
          await transaction.disputeResolution.update({
            where: { id: resolution.id },
            data: { status: 'rejected' },
          });
        } else {
          const acceptedByOthers = await transaction.disputeParticipantAction.count({
            where: {
              complaintId: disputeId,
              resolutionId: resolution.id,
              action: 'accept_proposal',
              userId: { not: user.id },
            },
          });
          if (acceptedByOthers >= 1) {
            await transaction.disputeResolution.update({
              where: { id: resolution.id },
              data: { status: 'accepted' },
            });
          }
        }
        await this.disputes.notifyParticipants(transaction, disputeId, complaint.booking, {
          eventType: 'dispute_settlement_response',
          title: 'Settlement response recorded',
          body:
            dto.action === 'accept_proposal'
              ? 'A participant accepted the proposed dispute settlement.'
              : 'A participant rejected the proposed dispute settlement.',
          eventKey: `${resolution.id}:${user.id}:${dto.action}`,
          metadata: { resolutionId: resolution.id, action: dto.action },
        });
        if (complaint.assignedAdminId) {
          await this.disputes.notifyUser(transaction, disputeId, complaint.assignedAdminId, {
            eventType: 'dispute_settlement_response',
            title: 'Participant settlement response',
            body: `A participant ${dto.action === 'accept_proposal' ? 'accepted' : 'rejected'} the proposed settlement.`,
            eventKey: `admin:${resolution.id}:${user.id}:${dto.action}`,
          });
        }
      });
      return this.getUserDispute(user, disputeId);
    }

    throw new BadRequestException('Unsupported participant dispute action');
  }

  async submitDisputeSatisfaction(
    user: User,
    disputeId: string,
    dto: SubmitDisputeSatisfactionDto,
  ) {
    const complaint = await this.prisma.taskComplaint.findFirst({
      where: {
        id: disputeId,
        booking: this.participantBookingScope(user),
      },
      select: { id: true, status: true },
    });
    if (!complaint) throw new NotFoundException('Dispute not found');
    if (!this.disputes.isClosed(complaint.status)) {
      throw new ConflictException('Satisfaction can be submitted only after the dispute is closed');
    }
    const survey = await this.prisma.disputeSatisfactionSurvey.upsert({
      where: { complaintId_userId: { complaintId: disputeId, userId: user.id } },
      create: {
        complaintId: disputeId,
        userId: user.id,
        userRole: user.role,
        rating: dto.rating,
        comment: dto.comment?.trim() || null,
      },
      update: { userRole: user.role, rating: dto.rating, comment: dto.comment?.trim() || null },
    });
    return {
      disputeId,
      rating: survey.rating,
      comment: survey.comment,
      updatedAt: survey.updatedAt.toISOString(),
    };
  }

  private participantDisputeView(row: ParticipantDisputeRow, userId: number) {
    const participantRole = row.booking.customerId === userId ? 'customer' : 'tasker';
    const myEvidence = row.evidences.filter((evidence) => evidence.uploadedById === userId);
    const visibleRequests = row.evidenceRequests.filter(
      (request) => request.requestedFrom === participantRole || request.requestedFrom === 'both',
    );
    const appliedResolution = row.resolutions.find((resolution) => resolution.status === 'applied') ?? null;
    const proposal =
      row.resolutions.find((resolution) => ['proposed', 'accepted'].includes(resolution.status)) ?? null;
    const mySurvey = row.satisfactionSurveys.find((survey) => survey.userId === userId) ?? null;
    const myProposalResponse = proposal
      ? row.participantActions.find(
          (action) =>
            action.userId === userId &&
            action.resolutionId === proposal.id &&
            ['accept_proposal', 'reject_proposal'].includes(action.action),
        ) ?? null
      : null;
    const isClosed = this.disputes.isClosed(row.status);
    const hasAppealed = row.participantActions.some(
      (action) => action.userId === userId && action.action === 'appeal',
    );
    const isAppealable = ['resolved', 'dismissed'].includes(row.status) && !hasAppealed;
    return {
      id: row.id,
      booking: {
        id: String(row.booking.id),
        status: row.booking.status,
        paymentStatus: row.booking.paymentStatus,
        bookingDate: row.booking.bookingDate.toISOString().slice(0, 10),
        startTime: row.booking.startTime,
        endTime: row.booking.endTime,
        service: {
          id: String(row.booking.service.id),
          name: row.booking.service.name,
          slug: row.booking.service.slug,
          icon: row.booking.service.icon ?? '',
        },
      },
      category: row.category,
      description: row.description,
      status: row.status,
      priority: row.priority,
      filedByCurrentUser: row.filedById === userId,
      filingDeadlineAt: row.filingDeadlineAt?.toISOString() ?? null,
      slaDueAt: row.slaDueAt?.toISOString() ?? null,
      slaBreachedAt: row.slaBreachedAt?.toISOString() ?? null,
      appealCount: row.appealCount,
      evidenceReview: {
        status: row.evidenceReviewStatus,
        awaitingResponseFrom: row.awaitingResponseFrom,
        responseDueAt: row.responseDueAt?.toISOString() ?? null,
      },
      evidenceRequests: visibleRequests.map((request) => ({
        id: request.id,
        message: request.message,
        requestedFrom: request.requestedFrom,
        status: request.status,
        dueAt: request.dueAt?.toISOString() ?? null,
        reminderSentAt: request.reminderSentAt?.toISOString() ?? null,
        overdueAt: request.overdueAt?.toISOString() ?? null,
        expiredAt: request.expiredAt?.toISOString() ?? null,
        fulfilledAt: request.fulfilledAt?.toISOString() ?? null,
        createdAt: request.createdAt.toISOString(),
      })),
      myEvidence: myEvidence.map((evidence) => ({
        id: evidence.id,
        name: evidence.name,
        publicId: evidence.publicId,
        secureUrl: evidence.secureUrl,
        resourceType: evidence.resourceType,
        bytes: evidence.bytes,
        mimeType: evidence.mimeType,
        source: evidence.source,
        reviewedAt: evidence.reviewedAt?.toISOString() ?? null,
        createdAt: evidence.createdAt.toISOString(),
      })),
      comments: row.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        author: {
          id: String(comment.author.id),
          role: comment.author.role,
          name: [comment.author.firstName, comment.author.lastName].filter(Boolean).join(' '),
          isCurrentUser: comment.author.id === userId,
        },
        createdAt: comment.createdAt.toISOString(),
      })),
      settlementProposal: proposal
        ? {
            id: proposal.id,
            status: proposal.status,
            type: proposal.actionType,
            refundAmount: proposal.refundAmount === null ? null : money(Number(proposal.refundAmount)),
            currency: proposal.currency,
            warningTarget: proposal.warningTarget,
            summary: proposal.summary,
            proposedAt: proposal.proposedAt?.toISOString() ?? null,
            responseDueAt: proposal.proposalResponseDueAt?.toISOString() ?? null,
            myResponse: myProposalResponse?.action ?? null,
          }
        : null,
      finalResolution:
        isClosed && appliedResolution
          ? {
              type: appliedResolution.actionType,
              refundAmount:
                appliedResolution.refundAmount === null
                  ? null
                  : money(Number(appliedResolution.refundAmount)),
              currency: appliedResolution.currency,
              warningTarget: appliedResolution.warningTarget,
              summary: appliedResolution.summary,
              providerRefundStatus: appliedResolution.providerRefundStatus,
              appliedAt: appliedResolution.appliedAt?.toISOString() ?? null,
            }
          : null,
      satisfaction: isClosed && mySurvey
        ? {
            rating: mySurvey.rating,
            comment: mySurvey.comment,
            updatedAt: mySurvey.updatedAt.toISOString(),
          }
        : null,
      availableParticipantActions: [
        'comment',
        ...(this.disputes.isActive(row.status) && row.filedById === userId ? ['withdraw'] : []),
        ...(proposal?.status === 'proposed' && !myProposalResponse
          ? ['accept_proposal', 'reject_proposal']
          : []),
        ...(isAppealable ? ['appeal'] : []),
      ],
      canSubmitSatisfaction: isClosed,
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }

  private disputeRequestKey(supplied?: string): string | null {
    const normalized = supplied?.trim();
    if (!normalized) return null;
    if (normalized.length < 8 || normalized.length > 120) {
      throw new BadRequestException('Idempotency-Key must contain between 8 and 120 characters');
    }
    return `client:${normalized}`;
  }

  private openedDisputeView(
    complaint: {
      id: string;
      category: string;
      description: string;
      attachments: Prisma.JsonValue | null;
      status: string;
      priority: string;
      filingDeadlineAt: Date | null;
      slaDueAt: Date | null;
      assignedAdminId: number | null;
      createdAt: Date;
    },
    bookingId: number,
    idempotentReplay: boolean,
  ) {
    return {
      id: complaint.id,
      bookingId: String(bookingId),
      category: complaint.category,
      description: complaint.description,
      attachments: Array.isArray(complaint.attachments) ? complaint.attachments : [],
      status: complaint.status,
      priority: complaint.priority,
      filingDeadlineAt: complaint.filingDeadlineAt?.toISOString() ?? null,
      slaDueAt: complaint.slaDueAt?.toISOString() ?? null,
      assignedAdminId: complaint.assignedAdminId,
      idempotentReplay,
      createdAt: complaint.createdAt.toISOString(),
    };
  }

  private enqueueBookingUpdate(
    bookingId: number,
    status: string,
    reason: string,
    transaction?: Prisma.TransactionClient,
    extra: Record<string, Prisma.InputJsonValue> = {},
  ) {
    return this.realtime.enqueueBooking(
      bookingId,
      'booking:updated',
      { bookingId: String(bookingId), status, reason, ...extra },
      transaction,
    );
  }

  private async loadQuoteContext(
    taskerId: number,
    serviceSlug: string,
    serviceOptionId: number | undefined,
    date: string,
    time: string,
    transaction?: Prisma.TransactionClient,
  ) {
    const db = (transaction ?? this.prisma) as Prisma.TransactionClient;
    const tasker = await db.user.findFirst({
      where: {
        id: taskerId,
        roles: { has: UserRole.Tasker },
        onboardingStatus: 'approved',
        accountStatus: 'active',
        deletedAt: null,
        taskerProfile: { is: { status: 'active' } },
      },
      select: { id: true, firstName: true, lastName: true, profilePicture: true, rating: true },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');
    const service = await db.service.findFirst({ where: { slug: serviceSlug, isActive: true } });
    if (!service) throw new BadRequestException(`Unknown service: ${serviceSlug}`);
    const option = serviceOptionId
      ? await db.serviceOption.findFirst({
          where: { id: serviceOptionId, serviceId: service.id, isActive: true },
        })
      : null;
    if (serviceOptionId && !option)
      throw new BadRequestException('Selected service option is unavailable');
    const taskerService = await db.userService.findUnique({
      where: { userId_serviceId: { userId: taskerId, serviceId: service.id } },
    });
    if (!taskerService) throw new BadRequestException('Tasker does not offer this service');
    const availability = await db.userAvailability.findMany({
      where: { userId: taskerId, date: dateOnlyToDate(date), isBooked: false },
    });
    const requestedMinutes = parseTimeToMinutes(time);
    const slot = availability.find(
      (item) => parseTimeToMinutes(item.startTime) === requestedMinutes,
    );
    if (!slot || requestedMinutes === null)
      throw new ConflictException('Requested date/time is unavailable');
    return { tasker, service, option, taskerService, slot };
  }

  private async quoteView(
    hourlyRate: number,
    startTime: string,
    endTime: string,
    tipAmount: number,
    donationAmount: number,
    service: { id: number; name: string | null; slug: string | null },
    option: { id: number; name: string; slug: string } | null,
    tasker: {
      id: number;
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
      rating: Prisma.Decimal;
    },
    bookingDate: Date,
    currency: string,
  ) {
    const start = parseTimeToMinutes(startTime) ?? 0;
    const end = parseTimeToMinutes(endTime) ?? start;
    const slotMinutes = Math.max(1, end - start);
    await this.platformSettings.assertBookingRules({ bookingDate, startTime, slotMinutes });
    const billableMinutes = Math.max(this.minimumBillableMinutes, slotMinutes);
    const rawServiceAmount = money(hourlyRate * (billableMinutes / 60));
    const pricing = await this.platformSettings.calculatePricingCharges({
      serviceAmount: rawServiceAmount,
      taskerId: tasker.id,
      serviceId: service.id,
      bookingDate,
      bookingCreatedAt: new Date(),
    });
    const serviceAmount = pricing.serviceAmount;
    const tip = money(tipAmount);
    const donation = money(donationAmount);
    const estimatedTotal = money(
      serviceAmount +
        pricing.platformFeeAmount +
        pricing.serviceSurchargeAmount +
        tip +
        donation +
        (pricing.taxInclusive ? 0 : pricing.taxAmount),
    );
    return {
      currency,
      tasker: {
        id: String(tasker.id),
        name: `${tasker.firstName ?? ''} ${tasker.lastName ?? ''}`.trim(),
        profilePicture: tasker.profilePicture ?? '',
        rating: Number(tasker.rating),
      },
      service: { id: String(service.id), name: service.name, slug: service.slug },
      serviceOption: option
        ? { id: String(option.id), name: option.name, slug: option.slug }
        : null,
      hourlyRate,
      selectedSlotMinutes: slotMinutes,
      minimumBillableMinutes: this.minimumBillableMinutes,
      estimatedBillableMinutes: billableMinutes,
      amounts: {
        service: serviceAmount,
        platformFee: pricing.platformFeeAmount,
        serviceSurcharge: pricing.serviceSurchargeAmount,
        tax: pricing.taxAmount,
        tip,
        donation,
        estimatedTotal,
      },
      pricingPolicy: {
        taskerTierCode: pricing.taskerTierCode,
        eliteCommissionPerkApplied: pricing.eliteCommissionPerkApplied,
        rawServiceAmount: pricing.rawServiceAmount,
        minimumTaskPrice: pricing.minimumTaskPrice,
        minimumTaskPriceApplied: pricing.minimumTaskPriceApplied,
        commissionRatePercent: pricing.commissionRatePercent,
        taxRatePercent: pricing.taxRatePercent,
        taxInclusive: pricing.taxInclusive,
      },
      chargeTiming: 'after_customer_approval_or_undisputed_auto_completion',
    };
  }

  private async findParticipantBooking(user: Pick<User, 'id' | 'role'>, bookingId: number) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, ...this.participantBookingScope(user) },
      include: BOOKING_INCLUDE,
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private participantBookingScope(user: Pick<User, 'id' | 'role'>): Prisma.BookingWhereInput {
    if (user.role === UserRole.Customer) return { customerId: user.id };
    if (user.role === UserRole.Tasker) return { taskerId: user.id };
    return { id: -1 };
  }

  private isParticipantInActiveRole(
    user: Pick<User, 'id' | 'role'>,
    booking: { customerId: number; taskerId: number },
  ): boolean {
    return (
      (user.role === UserRole.Customer && booking.customerId === user.id) ||
      (user.role === UserRole.Tasker && booking.taskerId === user.id)
    );
  }

  private serialize(booking: UnifiedBookingWithRelations, viewerId: number) {
    const viewerRole = booking.customerId === viewerId ? 'customer' : 'tasker';

    const counterparty =
      viewerRole === 'customer'
        ? {
            id: String(booking.tasker.id),
            name: `${booking.tasker.firstName ?? ''} ${booking.tasker.lastName ?? ''}`.trim(),
            profilePicture: booking.tasker.profilePicture ?? '',
            phone: `${booking.tasker.phoneCountryCode ?? ''}${booking.tasker.phoneNumber ?? ''}`,
            rating: Number(booking.tasker.rating),
            reviewsCount: booking.tasker.reviewsCount,
            completedTasks: booking.tasker.completedTasks,
            isElite: booking.tasker.isElite,
          }
        : {
            id: String(booking.customer.id),
            name: `${booking.customer.firstName ?? ''} ${booking.customer.lastName ?? ''}`.trim(),
            profilePicture: booking.customer.profilePicture ?? '',
            phone: `${booking.customer.phoneCountryCode ?? ''}${booking.customer.phoneNumber ?? ''}`,
            rating: Number(booking.customer.rating),
          };

    return {
      id: String(booking.id),
      status: booking.status,
      viewerRole,
      service: {
        id: String(booking.service.id),
        name: booking.service.name,
        slug: booking.service.slug,
        icon: booking.service.icon ?? '',
      },
      serviceOption: booking.serviceOption
        ? {
            id: String(booking.serviceOption.id),
            name: booking.serviceOption.name,
            slug: booking.serviceOption.slug,
          }
        : null,
      counterparty,
      hourlyRate: { amount: Number(booking.hourlyRate), currency: booking.paymentCurrency },
      date: dateOnlyFromDate(booking.bookingDate),
      startTime: booking.startTime,
      endTime: booking.endTime,
      location: formatLocation({
        label: booking.locationLabel,
        lat: Number(booking.locationLat),
        lng: Number(booking.locationLng),
        city: booking.locationCity,
        area: booking.locationArea,
      }),
      bookingDetails: {
        venueAddress: booking.venueAddress,
        apartmentSuite: booking.apartmentSuite,
        description: booking.description,
        attachments: Array.isArray(booking.attachments) ? booking.attachments : [],
      },
      workVerification: {
        required: booking.workVerificationRequired,
        frontDoorVerifiedAt: booking.frontDoorVerifiedAt?.toISOString() ?? null,
        startWorkVerifiedAt: booking.startWorkVerifiedAt?.toISOString() ?? null,
        completionProofAt: booking.completionProofAt?.toISOString() ?? null,
        completionVerifiedAt: booking.completionVerifiedAt?.toISOString() ?? null,
        completionVerifiedByRole: booking.completionVerifiedByRole,
        stateEndpoint: `/api/bookings/${booking.id}/work-verification`,
      },
      timing: {
        estimatedDurationMinutes: booking.estimatedDurationMinutes,
        extensionMinutes: booking.extensionMinutes,
        authorizedDurationMinutes: booking.estimatedDurationMinutes + booking.extensionMinutes,
        timerStatus: booking.workSession?.status ?? 'not_started',
        completionSubmittedAt: booking.completionSubmittedAt?.toISOString() ?? null,
        completionApprovalDueAt: booking.completionApprovalDueAt?.toISOString() ?? null,
        completionApprovedAt: booking.completionApprovedAt?.toISOString() ?? null,
        completionApprovedByRole: booking.completionApprovedByRole,
        completionAutoApprovedAt: booking.completionAutoApprovedAt?.toISOString() ?? null,
      },
      payment: {
        source: booking.paymentSource,
        status: booking.paymentStatus,
        currency: booking.paymentCurrency,
        serviceAmount: booking.serviceAmount === null ? null : Number(booking.serviceAmount),
        platformFeeAmount: Number(booking.platformFeeAmount),
        commissionRatePercent: Number(booking.commissionRatePercent),
        taxAmount: Number(booking.taxAmount),
        taxRatePercent: Number(booking.taxRatePercent),
        taxInclusive: booking.taxInclusive,
        serviceSurchargeAmount: Number(booking.serviceSurchargeAmount),
        tipAmount: Number(booking.tipAmount),
        donationAmount: Number(booking.donationAmount),
        donationDropoffRequested: booking.donationDropoffRequested,
        referralDiscountAmount: Number(booking.referralDiscountAmount),
        referralDiscountPercent: Number(booking.referralDiscountPercent),
        totalChargedAmount:
          booking.totalChargedAmount === null ? null : Number(booking.totalChargedAmount),
      },
      counts: {
        messages: booking._count.messages,
        complaints: booking._count.complaints,
        reviews: booking._count.reviews,
      },
      createdAt: booking.createdAt.toISOString(),
      updatedAt: booking.updatedAt.toISOString(),
    };
  }

  private assertDashboardRole(user: User): void {
    if (user.role !== UserRole.Customer && user.role !== UserRole.Tasker)
      throw new ForbiddenException('Bookings dashboard is available to customers and taskers');
  }
}
