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
import {
  dateOnlyFromDate,
  dateOnlyToDate,
  isTodayOrFutureDate,
  todayDateOnly,
} from '../../common/utils/date.util';
import { parseTimeToMinutes } from '../../common/utils/time.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type CustomTimeRequest, type User } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateCustomTimeRequestDto } from './dto/custom-time-request.dto';

export const CUSTOM_TIME_REQUEST_STATUS = {
  Pending: 'pending',
  Accepted: 'accepted',
  Rejected: 'rejected',
  Expired: 'expired',
  Fulfilled: 'fulfilled',
} as const;

export type CustomTimeRequestStatus =
  (typeof CUSTOM_TIME_REQUEST_STATUS)[keyof typeof CUSTOM_TIME_REQUEST_STATUS];

export interface CustomTimeRequestView {
  id: string;
  taskerId: string;
  customerId: string;
  serviceSlug: string;
  requestedDate: string;
  requestedTime: string;
  status: CustomTimeRequestStatus;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/** What a booking/quote call claims it is booking with a custom-time request. */
export interface CustomTimeBookingClaim {
  requestId: string;
  customerId: number;
  taskerId: number;
  serviceSlug: string;
  date: string;
  time: string;
}

const ACTIVE_TASKER_WHERE = {
  roles: { has: UserRole.Tasker },
  onboardingStatus: 'approved',
  accountStatus: 'active',
  deletedAt: null,
  taskerProfile: { is: { status: 'active' } },
} as const;

/**
 * Customer asks a Tasker for a date/time outside their listed availability; the
 * Tasker accepts or rejects. An accepted request lets that customer book exactly
 * that tasker/service/date/time once, inside a short window, without an open
 * UserAvailability slot. Pricing, payment and confirmation stay the normal
 * booking flow (BookingsService.quote/book).
 */
@Injectable()
export class CustomTimeRequestsService {
  private readonly logger = new Logger(CustomTimeRequestsService.name);
  private readonly ttlMinutes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {
    this.ttlMinutes = config.get<number>('customTimeRequests.ttlMinutes', 30);
  }

  async create(
    customerId: number,
    taskerId: number,
    dto: CreateCustomTimeRequestDto,
  ): Promise<CustomTimeRequestView> {
    if (customerId === taskerId) {
      throw new ForbiddenException({
        code: 'SELF_BOOKING_FORBIDDEN',
        message: 'A user cannot request a custom time from their own Tasker profile',
      });
    }
    if (!isTodayOrFutureDate(dto.requestedDate)) {
      throw new BadRequestException('requestedDate must be today or later');
    }
    if (this.isPastStart(dto.requestedDate, dto.requestedTime)) {
      throw new BadRequestException('requestedTime has already passed');
    }

    const taskerExists = await this.prisma.user.findFirst({
      where: { id: taskerId, roles: { has: UserRole.Tasker }, deletedAt: null },
      select: { id: true },
    });
    if (!taskerExists) throw new NotFoundException('Tasker not found');
    const activeTasker = await this.prisma.user.findFirst({
      where: { id: taskerId, ...ACTIVE_TASKER_WHERE },
      select: { id: true },
    });
    if (!activeTasker) throw new ConflictException('Tasker is not currently accepting bookings');
    const service = await this.prisma.service.findFirst({
      where: { slug: dto.serviceSlug, isActive: true },
      select: { id: true, name: true, slug: true },
    });
    const offered = service
      ? await this.prisma.userService.findUnique({
          where: { userId_serviceId: { userId: taskerId, serviceId: service.id } },
          select: { id: true },
        })
      : null;
    if (!service || !offered) {
      throw new ConflictException('Tasker does not offer this service');
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        // Serialize per (customer, tasker) pair across replicas before the
        // one-pending-request check; the partial unique index is the backstop.
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`custom-time-request:${customerId}:${taskerId}`}, 0))`;
        await this.expireStaleForPair(customerId, taskerId, transaction);
        const existing = await transaction.customTimeRequest.findFirst({
          where: { customerId, taskerId, status: CUSTOM_TIME_REQUEST_STATUS.Pending },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException({
            code: 'CUSTOM_TIME_REQUEST_ALREADY_PENDING',
            message: 'You already have a pending custom time request with this Tasker',
            requestId: existing.id,
          });
        }
        const row = await transaction.customTimeRequest.create({
          data: {
            customerId,
            taskerId,
            serviceId: service.id,
            serviceSlug: dto.serviceSlug,
            requestedDate: dateOnlyToDate(dto.requestedDate),
            requestedTime: dto.requestedTime,
            status: CUSTOM_TIME_REQUEST_STATUS.Pending,
            expiresAt: new Date(Date.now() + this.ttlMinutes * 60_000),
          },
        });
        await this.notifications.create(
          taskerId,
          {
            category: 'tasks',
            type: 'custom_time_request_created',
            title: 'New custom time request',
            body: `A customer asked for ${service.name ?? 'a service'} on ${dto.requestedDate} at ${dto.requestedTime}, outside your listed availability. Accept or decline within ${this.ttlMinutes} minutes.`,
            entityType: 'custom_time_request',
            entityId: row.id,
            metadata: { requestId: row.id, serviceSlug: dto.serviceSlug },
            audienceRole: UserRole.Tasker,
          },
          transaction,
        );
        return this.view(row);
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException({
          code: 'CUSTOM_TIME_REQUEST_ALREADY_PENDING',
          message: 'You already have a pending custom time request with this Tasker',
        });
      }
      throw error;
    }
  }

  async respond(taskerId: number, requestId: string, accept: boolean): Promise<CustomTimeRequestView> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "CustomTimeRequests" WHERE "id" = ${requestId} FOR UPDATE
      `;
      const request = await transaction.customTimeRequest.findUnique({ where: { id: requestId } });
      // Collapse a missing ID and another Tasker's request.
      if (!request || request.taskerId !== taskerId) {
        throw new NotFoundException('Custom time request not found');
      }
      const now = new Date();
      // A lapsed row is left for the expiry sweep (which notifies the customer);
      // any write here would be rolled back by the throw anyway.
      if (request.status === CUSTOM_TIME_REQUEST_STATUS.Pending && request.expiresAt <= now) {
        throw new ConflictException('This custom time request has expired');
      }
      if (request.status !== CUSTOM_TIME_REQUEST_STATUS.Pending) {
        throw new ConflictException(`This custom time request is already ${request.status}`);
      }

      const date = dateOnlyFromDate(request.requestedDate);
      if (accept && this.isPastStart(date, request.requestedTime, now)) {
        throw new ConflictException('The requested time has already passed');
      }

      const updated = await transaction.customTimeRequest.update({
        where: { id: request.id },
        data: accept
          ? {
              status: CUSTOM_TIME_REQUEST_STATUS.Accepted,
              respondedAt: now,
              // The customer now gets a fresh, equally short window to book.
              expiresAt: new Date(now.getTime() + this.ttlMinutes * 60_000),
            }
          : { status: CUSTOM_TIME_REQUEST_STATUS.Rejected, respondedAt: now },
      });
      await this.notifications.create(
        request.customerId,
        accept
          ? {
              category: 'tasks',
              type: 'custom_time_request_accepted',
              title: 'Custom time accepted',
              body: `Your Tasker accepted ${date} at ${request.requestedTime}. Complete your booking within ${this.ttlMinutes} minutes to secure it.`,
              entityType: 'custom_time_request',
              entityId: request.id,
              metadata: { requestId: request.id, taskerId: String(request.taskerId) },
              audienceRole: UserRole.Customer,
            }
          : {
              category: 'tasks',
              type: 'custom_time_request_rejected',
              title: 'Custom time declined',
              body: `Your Tasker cannot do ${date} at ${request.requestedTime}. You can pick a listed slot or send a new request.`,
              entityType: 'custom_time_request',
              entityId: request.id,
              metadata: { requestId: request.id, taskerId: String(request.taskerId) },
              audienceRole: UserRole.Customer,
            },
        transaction,
      );
      return this.view(updated);
    });
  }

  async get(user: User, requestId: string): Promise<CustomTimeRequestView> {
    const request = await this.prisma.customTimeRequest.findUnique({ where: { id: requestId } });
    if (!request || (request.customerId !== user.id && request.taskerId !== user.id)) {
      throw new NotFoundException('Custom time request not found');
    }
    return this.view(request);
  }

  /**
   * Validates that `claim` may bypass the open-slot requirement. Pass a
   * transaction to lock the request row (booking creation); the quote path
   * validates without locking. Returns the request's canonical service id.
   */
  async assertUsableForBooking(
    claim: CustomTimeBookingClaim,
    transaction?: Prisma.TransactionClient,
  ): Promise<CustomTimeRequest> {
    const db = (transaction ?? this.prisma) as Prisma.TransactionClient;
    if (transaction) {
      await transaction.$queryRaw`
        SELECT "id" FROM "CustomTimeRequests" WHERE "id" = ${claim.requestId} FOR UPDATE
      `;
    }
    const request = await db.customTimeRequest.findUnique({ where: { id: claim.requestId } });
    if (!request || request.customerId !== claim.customerId) {
      throw new NotFoundException('Custom time request not found');
    }
    const mismatch =
      request.taskerId !== claim.taskerId ||
      request.serviceSlug !== claim.serviceSlug ||
      dateOnlyFromDate(request.requestedDate) !== claim.date ||
      parseTimeToMinutes(request.requestedTime) !== parseTimeToMinutes(claim.time);
    if (mismatch) {
      throw new ConflictException({
        code: 'CUSTOM_TIME_REQUEST_MISMATCH',
        message:
          'customTimeRequestId does not match the Tasker, service, date and time being booked',
      });
    }
    if (request.status === CUSTOM_TIME_REQUEST_STATUS.Fulfilled) {
      throw new ConflictException({
        code: 'CUSTOM_TIME_REQUEST_FULFILLED',
        message: 'This custom time request has already been used for a booking',
      });
    }
    if (
      request.status === CUSTOM_TIME_REQUEST_STATUS.Expired ||
      (request.status === CUSTOM_TIME_REQUEST_STATUS.Accepted && request.expiresAt <= new Date())
    ) {
      throw new ConflictException({
        code: 'CUSTOM_TIME_REQUEST_EXPIRED',
        message: 'This custom time request has expired',
      });
    }
    if (request.status !== CUSTOM_TIME_REQUEST_STATUS.Accepted) {
      throw new ConflictException({
        code: 'CUSTOM_TIME_REQUEST_NOT_ACCEPTED',
        message: `This custom time request is ${request.status}, not accepted`,
      });
    }
    return request;
  }

  /** Must run in the same transaction that created the booking, after assertUsableForBooking locked the row. */
  async markFulfilled(
    requestId: string,
    bookingId: number,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const result = await transaction.customTimeRequest.updateMany({
      where: { id: requestId, status: CUSTOM_TIME_REQUEST_STATUS.Accepted },
      data: { status: CUSTOM_TIME_REQUEST_STATUS.Fulfilled, fulfilledAt: new Date(), bookingId },
    });
    if (result.count !== 1) {
      throw new ConflictException('This custom time request can no longer be used');
    }
  }

  /** Sweep: pending requests the Tasker never answered, and accepted ones the customer never booked. */
  async expireDueRequests(): Promise<{ examined: number; expired: number }> {
    const batchSize = this.config.get<number>('customTimeRequests.batchSize', 100);
    const candidates = await this.prisma.customTimeRequest.findMany({
      where: {
        status: { in: [CUSTOM_TIME_REQUEST_STATUS.Pending, CUSTOM_TIME_REQUEST_STATUS.Accepted] },
        expiresAt: { lte: new Date() },
      },
      select: { id: true },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });
    let expired = 0;
    for (const candidate of candidates) {
      try {
        const done = await this.prisma.$transaction(async (transaction) => {
          await transaction.$queryRaw`
            SELECT "id" FROM "CustomTimeRequests" WHERE "id" = ${candidate.id} FOR UPDATE
          `;
          const row = await transaction.customTimeRequest.findUnique({ where: { id: candidate.id } });
          if (
            !row ||
            row.expiresAt > new Date() ||
            (row.status !== CUSTOM_TIME_REQUEST_STATUS.Pending &&
              row.status !== CUSTOM_TIME_REQUEST_STATUS.Accepted)
          ) {
            return false;
          }
          await this.expireLocked(row, transaction);
          return true;
        });
        if (done) expired += 1;
      } catch (error) {
        this.logger.error(
          `Failed to expire custom time request ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { examined: candidates.length, expired };
  }

  view(row: CustomTimeRequest): CustomTimeRequestView {
    const lapsed =
      (row.status === CUSTOM_TIME_REQUEST_STATUS.Pending ||
        row.status === CUSTOM_TIME_REQUEST_STATUS.Accepted) &&
      row.expiresAt <= new Date();
    return {
      id: row.id,
      taskerId: String(row.taskerId),
      customerId: String(row.customerId),
      serviceSlug: row.serviceSlug,
      requestedDate: dateOnlyFromDate(row.requestedDate),
      requestedTime: row.requestedTime,
      // Report a lapsed row as expired even if the sweep has not run yet.
      status: (lapsed ? CUSTOM_TIME_REQUEST_STATUS.Expired : row.status) as CustomTimeRequestStatus,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async expireStaleForPair(
    customerId: number,
    taskerId: number,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const stale = await transaction.customTimeRequest.findMany({
      where: {
        customerId,
        taskerId,
        status: CUSTOM_TIME_REQUEST_STATUS.Pending,
        expiresAt: { lte: new Date() },
      },
    });
    for (const row of stale) await this.expireLocked(row, transaction);
  }

  private async expireLocked(
    request: CustomTimeRequest,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const wasPending = request.status === CUSTOM_TIME_REQUEST_STATUS.Pending;
    await transaction.customTimeRequest.update({
      where: { id: request.id },
      data: { status: CUSTOM_TIME_REQUEST_STATUS.Expired },
    });
    const date = dateOnlyFromDate(request.requestedDate);
    await this.notifications.create(
      request.customerId,
      {
        category: 'tasks',
        type: 'custom_time_request_expired',
        title: 'Custom time request expired',
        body: wasPending
          ? `Your Tasker did not respond to your request for ${date} at ${request.requestedTime} in time. You can send a new request.`
          : `Your booking window for ${date} at ${request.requestedTime} has closed. Send a new request if you still need this time.`,
        entityType: 'custom_time_request',
        entityId: request.id,
        metadata: { requestId: request.id, taskerId: String(request.taskerId) },
        audienceRole: UserRole.Customer,
      },
      transaction,
    );
  }

  /** Same UTC-minutes convention as BookingsService.isPastSlotStart. */
  private isPastStart(date: string, time: string, now = new Date()): boolean {
    if (date < todayDateOnly(now)) return true;
    if (date !== todayDateOnly(now)) return false;
    const minutes = parseTimeToMinutes(time);
    return minutes === null || minutes <= now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}
