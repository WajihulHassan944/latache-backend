import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../common/enums/user-role.enum';
import { dateOnlyFromDate, dateOnlyToDate, isFutureDate } from '../../common/utils/date.util';
import { formatLocation } from '../../common/utils/location.util';
import { normalizePagination } from '../../common/utils/pagination.util';
import { parseTimeToMinutes } from '../../common/utils/time.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { PAYMENT_SOURCE, PAYMENT_STATUS } from '../payments/payments.constants';
import { PaymentsService } from '../payments/payments.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import type { AddComplaintEvidenceDto, FileComplaintDto } from './dto/file-complaint.dto';
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
const ONGOING = ['en_route', 'arrived', 'in_progress'];
const HISTORY = ['completed', 'cancelled'];
const ACTIVE = [...BOOKED, ...ONGOING];
const money = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const BOOKING_INCLUDE = {
  service: true,
  serviceOption: true,
  customer: {
    select: {
      id: true, firstName: true, lastName: true, profilePicture: true,
      phoneCountryCode: true, phoneNumber: true, rating: true,
    },
  },
  tasker: {
    select: {
      id: true, firstName: true, lastName: true, profilePicture: true,
      phoneCountryCode: true, phoneNumber: true, rating: true, reviewsCount: true,
      completedTasks: true, isElite: true,
    },
  },
  workSession: true,
  latestLocation: true,
  _count: { select: { messages: true, complaints: true, reviews: true } },
} as const;

type UnifiedBookingWithRelations = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

@Injectable()
export class BookingsService {
  private readonly currency: string;
  private readonly minimumBillableMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: BookingsRepository,
    private readonly payments: PaymentsService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly platformSettings: PlatformSettingsService,
  ) {
    this.currency = config.get<string>('payments.currency', 'USD').toUpperCase();
    this.minimumBillableMinutes = config.get<number>('payments.minimumBillableMinutes', 120);
  }

  async quote(dto: BookingQuoteDto) {
    if (!isFutureDate(dto.date)) throw new BadRequestException('date must be after today');
    const context = await this.loadQuoteContext(dto.taskerId, dto.serviceSlug, dto.serviceOptionId, dto.date, dto.time);
    return this.quoteView(
      Number(context.taskerService.hourlyRate),
      context.slot.startTime,
      context.slot.endTime,
      dto.tipAmount ?? 0,
      dto.donationAmount ?? 0,
      context.service,
      context.option,
      context.tasker,
      dateOnlyToDate(dto.date),
    );
  }

  async book(customerId: number, dto: BookTaskerDto) {
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
    let stripePaymentMethodId: string | null = null;
    if (paymentSource === PAYMENT_SOURCE.Stripe) {
      stripePaymentMethodId = dto.stripePaymentMethodId ?? (await this.payments.defaultPaymentMethod(customerId));
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
        if (customer.role !== UserRole.Customer) throw new ForbiddenException('Only customers can create bookings');
        if (customer.accountStatus !== 'active') throw new ForbiddenException('Customer account is not active');

        const context = await this.loadQuoteContext(
          dto.taskerId,
          dto.serviceSlug,
          dto.serviceOptionId,
          dto.date,
          dto.time,
          transaction,
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
            hourlyRate: context.taskerService.hourlyRate,
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
            paymentCurrency: this.currency,
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
        orderBy: bucket === 'history'
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
    const booking = await this.findParticipantBooking(user.id, bookingId);
    return this.serialize(booking, user.id);
  }

  async next(user: User) {
    this.assertDashboardRole(user);
    const today = new Date();
    const booking = await this.prisma.booking.findFirst({
      where: {
        ...(user.role === UserRole.Customer ? { customerId: user.id } : { taskerId: user.id }),
        status: { in: ACTIVE },
        bookingDate: { gte: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) },
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
      if (['in_progress', 'completed', 'cancelled'].includes(booking.status)) {
        throw new ConflictException('This booking can no longer be cancelled by the customer');
      }
      await transaction.userAvailability.updateMany({
        where: { id: booking.availabilityId },
        data: { isBooked: false },
      });
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
      await this.notifications.create(booking.taskerId, {
        category: 'tasks', type: 'booking_cancelled_by_customer', title: 'Booking cancelled',
        body: 'The customer cancelled this booking.', entityType: 'booking', entityId: String(bookingId),
      }, transaction);
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
      const slots = await this.repository.findOpenSlotsForDate(booking.taskerId, dto.date, transaction);
      const requested = parseTimeToMinutes(dto.time);
      const slot = slots.find((item) => parseTimeToMinutes(item.startTime) === requested);
      if (!slot || requested === null) throw new ConflictException('Requested date/time is unavailable');
      if (!(await this.repository.claimSlot(slot.id, transaction))) throw new ConflictException('Requested slot has already been booked');
      await transaction.userAvailability.updateMany({ where: { id: booking.availabilityId }, data: { isBooked: false } });
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
      await this.notifications.create(booking.taskerId, {
        category: 'tasks', type: 'booking_rescheduled', title: 'Booking rescheduled',
        body: `The customer requested ${dto.date} at ${slot.startTime}. Please confirm the new time.`,
        entityType: 'booking', entityId: String(bookingId),
      }, transaction);
      return row;
    });
    return this.serialize(updated, customerId);
  }

  async extend(customerId: number, bookingId: number, dto: ExtendBookingDto) {
    const row = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
      const booking = await transaction.booking.findFirst({ where: { id: bookingId, customerId } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.status !== 'in_progress') throw new ConflictException('Additional time can be authorized only while the task is in progress');
      const updated = await transaction.booking.update({
        where: { id: bookingId },
        data: { extensionMinutes: { increment: dto.minutes } },
      });
      await this.notifications.create(booking.taskerId, {
        category: 'tasks', type: 'task_time_extended', title: 'Customer approved additional time',
        body: `${dto.minutes} additional minutes were approved.`, entityType: 'booking', entityId: String(bookingId),
      }, transaction);
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
      if (booking.status !== 'in_progress') {
        throw new ConflictException('Only an in-progress task can be marked complete');
      }

      const session = await transaction.taskWorkSession.findUnique({
        where: { bookingId },
      });
      if (!session || session.status !== 'stopped') {
        throw new ConflictException('The task timer must be stopped before completion');
      }

      await transaction.booking.update({
        where: { id: bookingId },
        data: { status: 'completed', taskCompletedAt: new Date() },
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
    });
  }

  async updateBilling(customerId: number, bookingId: number, dto: UpdateBookingBillingDto) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, customerId } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.paymentStatus === PAYMENT_STATUS.Paid) throw new ConflictException('A paid booking can no longer change tip or donation');
    if (
      dto.tipAmount === undefined &&
      dto.donationAmount === undefined &&
      dto.donationDropoffRequested === undefined
    ) {
      throw new BadRequestException('Provide tipAmount, donationAmount, or donationDropoffRequested');
    }
    const updated = await this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        ...(dto.tipAmount !== undefined ? { tipAmount: money(dto.tipAmount).toFixed(2) } : {}),
        ...(dto.donationAmount !== undefined ? { donationAmount: money(dto.donationAmount).toFixed(2) } : {}),
        ...(dto.donationDropoffRequested !== undefined
          ? { donationDropoffRequested: dto.donationDropoffRequested }
          : {}),
      },
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

  async navigation(userId: number, bookingId: number) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, OR: [{ customerId: userId }, { taskerId: userId }] },
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
      latestTaskerLocation: booking.latestLocation ? {
        lat: Number(booking.latestLocation.lat), lng: Number(booking.latestLocation.lng),
        accuracyM: booking.latestLocation.accuracyM === null ? null : Number(booking.latestLocation.accuracyM),
        headingDeg: booking.latestLocation.headingDeg === null ? null : Number(booking.latestLocation.headingDeg),
        capturedAt: booking.latestLocation.capturedAt.toISOString(),
      } : null,
      routeMetrics: null,
      routeMetricsReason: 'Distance, ETA and route geometry require a real maps/routing provider and are intentionally not fabricated.',
    };
  }

  async timer(userId: number, bookingId: number) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, OR: [{ customerId: userId }, { taskerId: userId }] },
      include: { workSession: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    const session = booking.workSession;
    if (!session) return { bookingId: String(bookingId), status: 'not_started', elapsedSeconds: 0, startedAt: null, pausedAt: null, stoppedAt: null, notes: '' };
    const endpoint = session.stoppedAt ?? session.pausedAt ?? new Date();
    const elapsedSeconds = Math.max(0, Math.floor((endpoint.getTime() - session.startedAt.getTime()) / 1000) - session.accumulatedPausedSecs);
    return {
      bookingId: String(bookingId), status: session.status, elapsedSeconds,
      startedAt: session.startedAt.toISOString(), pausedAt: session.pausedAt?.toISOString() ?? null,
      stoppedAt: session.stoppedAt?.toISOString() ?? null, notes: session.notes ?? '',
      authorizedDurationMinutes: booking.estimatedDurationMinutes + booking.extensionMinutes,
    };
  }

  async listComplaints(user: User, bookingId: number) {
    const participant = await this.prisma.booking.findFirst({
      where: { id: bookingId, OR: [{ customerId: user.id }, { taskerId: user.id }] },
      select: { id: true, customerId: true, taskerId: true },
    });
    if (!participant) throw new NotFoundException('Booking not found');
    const participantRole = participant.customerId === user.id ? 'customer' : 'tasker';

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

  async fileComplaint(userId: number, bookingId: number, dto: FileComplaintDto) {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, OR: [{ customerId: userId }, { taskerId: userId }] },
      select: { id: true, customerId: true, taskerId: true, status: true, paymentStatus: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status === 'cancelled') {
      throw new ConflictException('A complaint cannot be filed for an inaccessible cancelled booking');
    }
    const otherId = booking.customerId === userId ? booking.taskerId : booking.customerId;
    const participantRole = booking.customerId === userId ? 'customer' : 'tasker';
    const priority = dto.category === 'safety'
      ? 'urgent'
      : ['missed_appointment', 'overcharged', 'payment'].includes(dto.category)
        ? 'high'
        : 'normal';
    for (const attachment of dto.attachments ?? []) {
      this.assertBookingAttachmentOwnership(userId, participantRole, attachment.publicId, attachment.secureUrl);
    }

    const created = await this.prisma.$transaction(async (transaction) => {
      const complaint = await transaction.taskComplaint.create({
        data: {
          bookingId,
          filedById: userId,
          category: dto.category,
          description: dto.description,
          priority,
          evidenceReviewStatus: dto.attachments?.length ? 'pending' : 'not_required',
          attachments: dto.attachments?.length
            ? (dto.attachments as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        },
      });

      if (dto.attachments?.length) {
        await transaction.disputeEvidence.createMany({
          data: dto.attachments.map((attachment) => ({
            complaintId: complaint.id,
            uploadedById: userId,
            uploadedByRole: participantRole,
            source: 'initial_complaint',
            name: attachment.originalFileName?.trim() || attachment.publicId.split('/').filter(Boolean).pop() || 'Complaint attachment',
            publicId: attachment.publicId,
            secureUrl: attachment.secureUrl,
            resourceType: attachment.resourceType ?? null,
            bytes: attachment.bytes ?? null,
            mimeType: attachment.mimeType ?? null,
          })),
        });
      }

      if (![PAYMENT_STATUS.Paid, PAYMENT_STATUS.PartiallyRefunded, PAYMENT_STATUS.Refunded, PAYMENT_STATUS.Failed].includes(booking.paymentStatus as never)) {
        await transaction.booking.update({
          where: { id: bookingId },
          data: { paymentStatus: PAYMENT_STATUS.OnHoldDispute },
        });
      }
      await this.notifications.create(otherId, {
        category: 'tasks',
        type: 'booking_dispute_opened',
        title: 'A booking dispute was opened',
        body: 'A complaint was submitted for this booking.',
        entityType: 'booking',
        entityId: String(bookingId),
        metadata: { complaintId: complaint.id, priority },
      }, transaction);
      return complaint;
    });
    return {
      id: created.id,
      bookingId: String(bookingId),
      category: created.category,
      description: created.description,
      attachments: Array.isArray(created.attachments) ? created.attachments : [],
      status: created.status,
      priority: created.priority,
      createdAt: created.createdAt.toISOString(),
    };
  }

  async addComplaintEvidence(
    user: User,
    bookingId: number,
    complaintId: string,
    dto: AddComplaintEvidenceDto,
  ) {
    if (!dto.evidence.length) throw new BadRequestException('At least one evidence item is required');

    const result = await this.prisma.$transaction(async (transaction) => {
      const booking = await transaction.booking.findFirst({
        where: { id: bookingId, OR: [{ customerId: user.id }, { taskerId: user.id }] },
        select: { id: true, customerId: true, taskerId: true },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      const participantRole = booking.customerId === user.id ? 'customer' : 'tasker';
      for (const evidence of dto.evidence) {
        this.assertBookingAttachmentOwnership(user.id, participantRole, evidence.publicId, evidence.secureUrl);
      }

      await transaction.$queryRaw`
        SELECT "id" FROM "TaskComplaints"
        WHERE "id" = ${complaintId} AND "bookingId" = ${bookingId}
        FOR UPDATE
      `;
      const complaint = await transaction.taskComplaint.findFirst({
        where: { id: complaintId, bookingId },
      });
      if (!complaint) throw new NotFoundException('Dispute not found');
      if (!['open', 'under_investigation', 'escalated'].includes(complaint.status)) {
        throw new ConflictException('Evidence cannot be added to a closed dispute');
      }

      await transaction.disputeEvidence.createMany({
        data: dto.evidence.map((evidence) => ({
          complaintId,
          uploadedById: user.id,
          uploadedByRole: participantRole,
          source: 'requested_evidence',
          name: evidence.name,
          publicId: evidence.publicId ?? null,
          secureUrl: evidence.secureUrl,
          resourceType: evidence.resourceType ?? null,
          bytes: evidence.bytes ?? null,
          mimeType: evidence.mimeType ?? null,
        })),
      });

      const now = new Date();
      await transaction.disputeEvidenceRequest.updateMany({
        where: {
          complaintId,
          status: 'pending',
          requestedFrom: participantRole,
        },
        data: { status: 'fulfilled', fulfilledAt: now },
      });

      // Backward compatibility for any pre-v3.9 request stored as "both": the first
      // participant response leaves the request pending for the other participant.
      const otherRole = participantRole === 'customer' ? 'tasker' : 'customer';
      await transaction.disputeEvidenceRequest.updateMany({
        where: { complaintId, status: 'pending', requestedFrom: 'both' },
        data: { requestedFrom: otherRole },
      });

      const pendingRows = await transaction.disputeEvidenceRequest.findMany({
        where: { complaintId, status: 'pending' },
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
      const responseDueAt = pendingRows
        .map((request) => request.dueAt)
        .filter((value): value is Date => value !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

      await transaction.taskComplaint.update({
        where: { id: complaintId },
        data: {
          evidenceReviewStatus: 'pending',
          awaitingResponseFrom,
          responseDueAt,
        },
      });
      const pendingRequests = pendingRows.length;

      if (complaint.assignedAdminId) {
        await this.notifications.create(complaint.assignedAdminId, {
          category: 'tasks',
          type: 'dispute_evidence_received',
          title: 'Dispute evidence received',
          body: `${participantRole === 'customer' ? 'Customer' : 'Tasker'} submitted additional evidence.`,
          entityType: 'dispute',
          entityId: complaintId,
          metadata: { bookingId, evidenceCount: dto.evidence.length },
        }, transaction);
      }
      return { participantRole, pendingRequests };
    });

    return {
      disputeId: complaintId,
      bookingId: String(bookingId),
      submittedByRole: result.participantRole,
      submittedCount: dto.evidence.length,
      pendingEvidenceRequests: result.pendingRequests,
      dispute: (await this.listComplaints(user, bookingId)).find((item) => item.id === complaintId) ?? null,
    };
  }

  private assertBookingAttachmentOwnership(
    userId: number,
    role: 'customer' | 'tasker',
    publicId: string,
    secureUrl: string,
  ): void {
    const baseFolder = this.config
      .get<string>('cloudinary.folder', 'latache')
      .replace(/^\/+|\/+$/g, '');
    const expectedPrefix = `${baseFolder}/booking-attachments/${role}/${userId}/`;
    if (!publicId.startsWith(expectedPrefix)) {
      throw new ForbiddenException(
        'Dispute evidence must reference a booking attachment uploaded by the current account',
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(secureUrl);
    } catch {
      throw new BadRequestException('Invalid Cloudinary evidence URL');
    }
    const cloudName = this.config.get<string>('cloudinary.cloudName', '').trim();
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
      throw new ForbiddenException('Dispute evidence URL must be a secure Cloudinary URL');
    }
    if (cloudName && !parsed.pathname.startsWith(`/${cloudName}/`)) {
      throw new ForbiddenException('Dispute evidence URL belongs to a different Cloudinary account');
    }
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
      where: { id: taskerId, role: UserRole.Tasker, onboardingStatus: { not: null }, accountStatus: 'active', deletedAt: null },
      select: { id: true, firstName: true, lastName: true, profilePicture: true, rating: true },
    });
    if (!tasker) throw new NotFoundException('Tasker not found');
    const service = await db.service.findFirst({ where: { slug: serviceSlug } });
    if (!service) throw new BadRequestException(`Unknown service: ${serviceSlug}`);
    const option = serviceOptionId ? await db.serviceOption.findFirst({ where: { id: serviceOptionId, serviceId: service.id, isActive: true } }) : null;
    if (serviceOptionId && !option) throw new BadRequestException('Selected service option is unavailable');
    const taskerService = await db.userService.findUnique({ where: { userId_serviceId: { userId: taskerId, serviceId: service.id } } });
    if (!taskerService) throw new BadRequestException('Tasker does not offer this service');
    const availability = await db.userAvailability.findMany({ where: { userId: taskerId, date: dateOnlyToDate(date), isBooked: false } });
    const requestedMinutes = parseTimeToMinutes(time);
    const slot = availability.find((item) => parseTimeToMinutes(item.startTime) === requestedMinutes);
    if (!slot || requestedMinutes === null) throw new ConflictException('Requested date/time is unavailable');
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
    tasker: { id: number; firstName: string | null; lastName: string | null; profilePicture: string | null; rating: Prisma.Decimal },
    bookingDate: Date,
  ) {
    const start = parseTimeToMinutes(startTime) ?? 0;
    const end = parseTimeToMinutes(endTime) ?? start;
    const slotMinutes = Math.max(1, end - start);
    await this.platformSettings.assertBookingRules({ bookingDate, startTime, slotMinutes });
    const billableMinutes = Math.max(this.minimumBillableMinutes, slotMinutes);
    const serviceAmount = money(hourlyRate * (billableMinutes / 60));
    const pricing = await this.platformSettings.calculatePricingCharges({
      serviceAmount,
      taskerId: tasker.id,
      serviceId: service.id,
      bookingDate,
      bookingCreatedAt: new Date(),
    });
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
      currency: this.currency,
      tasker: { id: String(tasker.id), name: `${tasker.firstName ?? ''} ${tasker.lastName ?? ''}`.trim(), profilePicture: tasker.profilePicture ?? '', rating: Number(tasker.rating) },
      service: { id: String(service.id), name: service.name, slug: service.slug },
      serviceOption: option ? { id: String(option.id), name: option.name, slug: option.slug } : null,
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
        commissionRatePercent: pricing.commissionRatePercent,
        taxRatePercent: pricing.taxRatePercent,
        taxInclusive: pricing.taxInclusive,
      },
      chargeTiming: 'after_task_completion',
    };
  }

  private async findParticipantBooking(userId: number, bookingId: number) {
    const booking = await this.prisma.booking.findFirst({ where: { id: bookingId, OR: [{ customerId: userId }, { taskerId: userId }] }, include: BOOKING_INCLUDE });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private serialize(booking: UnifiedBookingWithRelations, viewerId: number) {
    const viewerRole = booking.customerId === viewerId ? 'customer' : 'tasker';

    const counterparty = viewerRole === 'customer'
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
      id: String(booking.id), status: booking.status, viewerRole,
      service: { id: String(booking.service.id), name: booking.service.name, slug: booking.service.slug, icon: booking.service.icon ?? '' },
      serviceOption: booking.serviceOption ? { id: String(booking.serviceOption.id), name: booking.serviceOption.name, slug: booking.serviceOption.slug } : null,
      counterparty,
      hourlyRate: { amount: Number(booking.hourlyRate), currency: booking.paymentCurrency },
      date: dateOnlyFromDate(booking.bookingDate), startTime: booking.startTime, endTime: booking.endTime,
      location: formatLocation({ label: booking.locationLabel, lat: Number(booking.locationLat), lng: Number(booking.locationLng), city: booking.locationCity, area: booking.locationArea }),
      bookingDetails: { venueAddress: booking.venueAddress, apartmentSuite: booking.apartmentSuite, description: booking.description, attachments: Array.isArray(booking.attachments) ? booking.attachments : [] },
      timing: { estimatedDurationMinutes: booking.estimatedDurationMinutes, extensionMinutes: booking.extensionMinutes, authorizedDurationMinutes: booking.estimatedDurationMinutes + booking.extensionMinutes, timerStatus: booking.workSession?.status ?? 'not_started' },
      payment: { source: booking.paymentSource, status: booking.paymentStatus, currency: booking.paymentCurrency, serviceAmount: booking.serviceAmount === null ? null : Number(booking.serviceAmount), platformFeeAmount: Number(booking.platformFeeAmount), commissionRatePercent: Number(booking.commissionRatePercent), taxAmount: Number(booking.taxAmount), taxRatePercent: Number(booking.taxRatePercent), taxInclusive: booking.taxInclusive, serviceSurchargeAmount: Number(booking.serviceSurchargeAmount), tipAmount: Number(booking.tipAmount), donationAmount: Number(booking.donationAmount), donationDropoffRequested: booking.donationDropoffRequested, totalChargedAmount: booking.totalChargedAmount === null ? null : Number(booking.totalChargedAmount) },
      counts: { messages: booking._count.messages, complaints: booking._count.complaints, reviews: booking._count.reviews },
      createdAt: booking.createdAt.toISOString(), updatedAt: booking.updatedAt.toISOString(),
    };
  }

  private assertDashboardRole(user: User): void {
    if (user.role !== UserRole.Customer && user.role !== UserRole.Tasker) throw new ForbiddenException('Bookings dashboard is available to customers and taskers');
  }
}
