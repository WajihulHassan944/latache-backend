import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  dateOnlyFromDate,
  dateOnlyToDate,
  todayDateOnly,
} from '../../../common/utils/date.util';
import { normalizePagination } from '../../../common/utils/pagination.util';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type {
  NavigationView,
  TaskActionView,
  TaskerTaskListView,
  TaskerTaskView,
  TaskTimerView,
} from '../tasker-dashboard.contracts';
import {
  TASKER_BOOKED_STATUSES,
  TASKER_BOOKING_STATUS,
  TASKER_HISTORY_STATUSES,
  TASKER_ONGOING_STATUSES,
  TASK_TIMER_STATUS,
  TERMINAL_TASK_STATUSES,
} from '../tasker-dashboard.constants';
import type {
  CancelTaskDto,
  ListTaskerTasksQueryDto,
  UpdateTaskerLocationDto,
  UpdateTimerNotesDto,
} from '../dto';
import {
  estimatedTaskAmount,
  safeJsonArray,
  toIso,
} from '../tasker-dashboard.utils';
import { NotificationsService } from '../../notifications/notifications.service';

type TaskerBookingWithRelations = Prisma.BookingGetPayload<{
  include: {
    customer: {
      select: {
        id: true;
        firstName: true;
        lastName: true;
        profilePicture: true;
        phoneCountryCode: true;
        phoneNumber: true;
      };
    };
    service: { select: { id: true; name: true; slug: true; icon: true } };
    workSession: true;
  };
}>;

@Injectable()
export class TaskerTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async list(
    taskerId: number,
    query: ListTaskerTasksQueryDto,
  ): Promise<TaskerTaskListView> {
    const bucket = query.bucket ?? 'booked';
    const statuses =
      bucket === 'booked'
        ? [...TASKER_BOOKED_STATUSES]
        : bucket === 'ongoing'
          ? [...TASKER_ONGOING_STATUSES]
          : [...TASKER_HISTORY_STATUSES];
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const where: Prisma.BookingWhereInput = {
      taskerId,
      status: { in: statuses },
      ...(query.bookingId ? { id: query.bookingId } : {}),
      ...(query.date ? { bookingDate: new Date(`${query.date}T00:00:00.000Z`) } : {}),
    };
    const direction = query.direction ?? (bucket === 'history' ? 'desc' : 'asc');
    const orderBy: Prisma.BookingOrderByWithRelationInput[] =
      query.sortBy === 'id'
        ? [{ id: direction }]
        : query.sortBy === 'price'
          ? [{ hourlyRate: direction }, { bookingDate: direction }]
          : [{ bookingDate: direction }, { startTime: direction }];
    const [rows, totalItems] = await Promise.all([
      this.prisma.booking.findMany({
        where,
        include: this.includeRelations(),
        orderBy,
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
      items: rows.map((row) => this.serialize(row)),
    };
  }

  async get(taskerId: number, bookingId: number): Promise<TaskerTaskView> {
    const booking = await this.findOwnedBooking(taskerId, bookingId);
    if (!booking) throw new NotFoundException('Task not found');
    return this.serialize(booking);
  }

  async next(taskerId: number): Promise<TaskerTaskView | null> {
    const booking = await this.prisma.booking.findFirst({
      where: {
        taskerId,
        bookingDate: { gte: dateOnlyToDate(todayDateOnly()) },
        status: { in: [...TASKER_BOOKED_STATUSES, ...TASKER_ONGOING_STATUSES] },
      },
      include: this.includeRelations(),
      orderBy: [{ bookingDate: 'asc' }, { startTime: 'asc' }],
    });
    return booking ? this.serialize(booking) : null;
  }

  async confirm(taskerId: number, bookingId: number): Promise<TaskerTaskView> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockOwnedBooking(taskerId, bookingId, transaction);
      if (booking.status !== TASKER_BOOKING_STATUS.Pending) {
        throw new ConflictException('Only pending tasks can be confirmed');
      }
      const row = await transaction.booking.update({
        where: { id: bookingId },
        data: { status: TASKER_BOOKING_STATUS.Confirmed, confirmedAt: new Date() },
        include: this.includeRelations(),
      });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'task_confirmed',
          title: 'Task confirmed',
          body: 'Your tasker confirmed the booking.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      return row;
    });
    return this.serialize(updated);
  }

  async cancel(
    taskerId: number,
    bookingId: number,
    dto: CancelTaskDto,
  ): Promise<TaskerTaskView> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockOwnedBooking(taskerId, bookingId, transaction);
      if (
        [
          TASKER_BOOKING_STATUS.InProgress,
          TASKER_BOOKING_STATUS.Completed,
          TASKER_BOOKING_STATUS.Cancelled,
        ].includes(booking.status as never)
      ) {
        throw new ConflictException('This task can no longer be cancelled by the tasker');
      }
      await transaction.userAvailability.updateMany({
        where: { id: booking.availabilityId },
        data: { isBooked: false },
      });
      const row = await transaction.booking.update({
        where: { id: bookingId },
        data: {
          status: TASKER_BOOKING_STATUS.Cancelled,
          cancelledAt: new Date(),
          cancelledByRole: 'tasker',
          cancellationReason: dto.reason,
        },
        include: this.includeRelations(),
      });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'task_cancelled_by_tasker',
          title: 'Task cancelled',
          body: 'Your tasker cancelled the booking. Support can assist with the next steps.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      return row;
    });
    return this.serialize(updated);
  }

  async startNavigation(taskerId: number, bookingId: number): Promise<NavigationView> {
    await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockOwnedBooking(taskerId, bookingId, transaction);
      if (booking.status !== TASKER_BOOKING_STATUS.Confirmed) {
        throw new ConflictException('Navigation can start only for a confirmed task');
      }
      await transaction.booking.update({
        where: { id: bookingId },
        data: { status: TASKER_BOOKING_STATUS.EnRoute, enRouteAt: new Date() },
      });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'tasker_en_route',
          title: 'Your tasker is on the way',
          body: 'Your tasker started heading to the booking location.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
    });
    return this.navigation(taskerId, bookingId);
  }

  async updateLocation(
    taskerId: number,
    bookingId: number,
    dto: UpdateTaskerLocationDto,
  ): Promise<NavigationView> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, taskerId },
      select: { id: true, status: true },
    });
    if (!booking) throw new NotFoundException('Task not found');
    if (
      ![
        TASKER_BOOKING_STATUS.EnRoute,
        TASKER_BOOKING_STATUS.Arrived,
        TASKER_BOOKING_STATUS.InProgress,
      ].includes(booking.status as never)
    ) {
      throw new ConflictException('Location can be updated only for an active task');
    }
    await this.prisma.taskerTaskLocation.upsert({
      where: { bookingId },
      create: {
        bookingId,
        taskerId,
        lat: dto.lat,
        lng: dto.lng,
        accuracyM: dto.accuracyM,
        headingDeg: dto.headingDeg,
        capturedAt: new Date(),
      },
      update: {
        lat: dto.lat,
        lng: dto.lng,
        accuracyM: dto.accuracyM ?? null,
        headingDeg: dto.headingDeg ?? null,
        capturedAt: new Date(),
      },
    });
    return this.navigation(taskerId, bookingId);
  }

  async arrive(taskerId: number, bookingId: number): Promise<NavigationView> {
    await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockOwnedBooking(taskerId, bookingId, transaction);
      if (booking.status !== TASKER_BOOKING_STATUS.EnRoute) {
        throw new ConflictException('Arrival can be marked only after starting navigation');
      }
      await transaction.booking.update({
        where: { id: bookingId },
        data: { status: TASKER_BOOKING_STATUS.Arrived, arrivedAt: new Date() },
      });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'tasker_arrived',
          title: 'Your tasker has arrived',
          body: 'Your tasker is at the booking location.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
    });
    return this.navigation(taskerId, bookingId);
  }

  async navigation(taskerId: number, bookingId: number): Promise<NavigationView> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, taskerId },
      include: {
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
            phoneCountryCode: true,
            phoneNumber: true,
          },
        },
        latestLocation: true,
        workSession: true,
      },
    });
    if (!booking) throw new NotFoundException('Task not found');
    return {
      bookingId: String(booking.id),
      status: booking.status,
      customer: {
        id: String(booking.customer.id),
        name: `${booking.customer.firstName ?? ''} ${booking.customer.lastName ?? ''}`.trim(),
        avatar: booking.customer.profilePicture ?? '',
        phoneCountryCode: booking.customer.phoneCountryCode ?? '',
        phoneNumber: booking.customer.phoneNumber ?? '',
      },
      destination: {
        label: booking.locationLabel,
        venueAddress: booking.venueAddress,
        apartmentSuite: booking.apartmentSuite,
        lat: Number(booking.locationLat),
        lng: Number(booking.locationLng),
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
        'ETA and route geometry are intentionally not fabricated; calculate them with the client map provider using destination and latestTaskerLocation.',
      actions: this.actions(booking.status, booking.workSession?.status ?? null),
    };
  }

  async timer(taskerId: number, bookingId: number): Promise<TaskTimerView> {
    const booking = await this.prisma.booking.findFirst({
      where: { id: bookingId, taskerId },
      include: { workSession: true },
    });
    if (!booking) throw new NotFoundException('Task not found');
    return this.timerView(bookingId, booking.workSession);
  }

  async startTimer(taskerId: number, bookingId: number): Promise<TaskTimerView> {
    const session = await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockOwnedBooking(taskerId, bookingId, transaction);
      if (booking.status !== TASKER_BOOKING_STATUS.Arrived) {
        throw new ConflictException('The task can start only after arrival is confirmed');
      }
      const existing = await transaction.taskWorkSession.findUnique({
        where: { bookingId },
      });
      if (existing) throw new ConflictException('A timer already exists for this task');
      const now = new Date();
      const created = await transaction.taskWorkSession.create({
        data: {
          bookingId,
          taskerId,
          status: TASK_TIMER_STATUS.Running,
          startedAt: now,
        },
      });
      await transaction.booking.update({
        where: { id: bookingId },
        data: {
          status: TASKER_BOOKING_STATUS.InProgress,
          taskStartedAt: now,
        },
      });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'task_started',
          title: 'Task started',
          body: 'Your tasker started working on the booking.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      return created;
    });
    return this.timerView(bookingId, session);
  }

  async pauseTimer(taskerId: number, bookingId: number): Promise<TaskTimerView> {
    const session = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwnedBooking(taskerId, bookingId, transaction);
      const current = await this.lockSession(bookingId, transaction);
      if (current.status !== TASK_TIMER_STATUS.Running) {
        throw new ConflictException('Only a running timer can be paused');
      }
      return transaction.taskWorkSession.update({
        where: { bookingId },
        data: { status: TASK_TIMER_STATUS.Paused, pausedAt: new Date() },
      });
    });
    return this.timerView(bookingId, session);
  }

  async resumeTimer(taskerId: number, bookingId: number): Promise<TaskTimerView> {
    const session = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwnedBooking(taskerId, bookingId, transaction);
      const current = await this.lockSession(bookingId, transaction);
      if (current.status !== TASK_TIMER_STATUS.Paused || !current.pausedAt) {
        throw new ConflictException('Only a paused timer can be resumed');
      }
      const pausedDelta = Math.max(
        0,
        Math.floor((Date.now() - current.pausedAt.getTime()) / 1000),
      );
      return transaction.taskWorkSession.update({
        where: { bookingId },
        data: {
          status: TASK_TIMER_STATUS.Running,
          pausedAt: null,
          accumulatedPausedSecs: {
            increment: pausedDelta,
          },
        },
      });
    });
    return this.timerView(bookingId, session);
  }

  async stopTimer(taskerId: number, bookingId: number): Promise<TaskTimerView> {
    const session = await this.prisma.$transaction(async (transaction) => {
      await this.lockOwnedBooking(taskerId, bookingId, transaction);
      const current = await this.lockSession(bookingId, transaction);
      if (
        ![TASK_TIMER_STATUS.Running, TASK_TIMER_STATUS.Paused].includes(
          current.status as never,
        )
      ) {
        throw new ConflictException('The timer is already stopped');
      }
      const now = new Date();
      const pausedDelta =
        current.status === TASK_TIMER_STATUS.Paused && current.pausedAt
          ? Math.max(0, Math.floor((now.getTime() - current.pausedAt.getTime()) / 1000))
          : 0;
      return transaction.taskWorkSession.update({
        where: { bookingId },
        data: {
          status: TASK_TIMER_STATUS.Stopped,
          pausedAt: null,
          stoppedAt: now,
          accumulatedPausedSecs: { increment: pausedDelta },
        },
      });
    });
    return this.timerView(bookingId, session);
  }

  async updateTimerNotes(
    taskerId: number,
    bookingId: number,
    dto: UpdateTimerNotesDto,
  ): Promise<TaskTimerView> {
    await this.requireOwnedBookingId(taskerId, bookingId);
    const session = await this.prisma.taskWorkSession.findUnique({ where: { bookingId } });
    if (!session) throw new NotFoundException('Task timer has not been started');
    const updated = await this.prisma.taskWorkSession.update({
      where: { bookingId },
      data: { notes: dto.notes },
    });
    return this.timerView(bookingId, updated);
  }

  async complete(taskerId: number, bookingId: number): Promise<TaskerTaskView> {
    const existing = await this.findOwnedBooking(taskerId, bookingId);
    if (!existing) throw new NotFoundException('Task not found');
    if (existing.status === TASKER_BOOKING_STATUS.Completed) {
      return this.serialize(existing);
    }
    const updated = await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockOwnedBooking(taskerId, bookingId, transaction);
      if (booking.status === TASKER_BOOKING_STATUS.Completed) {
        return transaction.booking.findUniqueOrThrow({
          where: { id: bookingId },
          include: this.includeRelations(),
        });
      }
      if (booking.status !== TASKER_BOOKING_STATUS.InProgress) {
        throw new ConflictException('Only an in-progress task can be completed');
      }
      const session = await transaction.taskWorkSession.findUnique({
        where: { bookingId },
      });
      if (!session || session.status !== TASK_TIMER_STATUS.Stopped) {
        throw new ConflictException('Stop the task timer before completing the task');
      }
      const now = new Date();
      const row = await transaction.booking.update({
        where: { id: bookingId },
        data: { status: TASKER_BOOKING_STATUS.Completed, taskCompletedAt: now },
        include: this.includeRelations(),
      });
      await transaction.user.update({
        where: { id: taskerId },
        data: { completedTasks: { increment: 1 } },
      });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'task_completed',
          title: 'Task completed',
          body: 'Your tasker marked the booking as completed.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      return row;
    });
    return this.serialize(updated);
  }

  async completionMetrics(taskerId: number): Promise<{
    completedTasks: number;
    taskCompletionPercent: number;
  }> {
    const [completed, terminal] = await Promise.all([
      this.prisma.booking.count({
        where: { taskerId, status: TASKER_BOOKING_STATUS.Completed },
      }),
      this.prisma.booking.count({
        where: { taskerId, status: { in: [...TASKER_HISTORY_STATUSES] } },
      }),
    ]);
    return {
      completedTasks: completed,
      taskCompletionPercent: terminal === 0 ? 0 : Math.round((completed / terminal) * 100),
    };
  }

  private includeRelations() {
    return {
      customer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          profilePicture: true,
          phoneCountryCode: true,
          phoneNumber: true,
        },
      },
      service: { select: { id: true, name: true, slug: true, icon: true } },
      workSession: true,
    } as const;
  }

  private async findOwnedBooking(
    taskerId: number,
    bookingId: number,
  ): Promise<TaskerBookingWithRelations | null> {
    return this.prisma.booking.findFirst({
      where: { id: bookingId, taskerId },
      include: this.includeRelations(),
    });
  }

  private async requireOwnedBookingId(taskerId: number, bookingId: number): Promise<void> {
    const exists = await this.prisma.booking.count({ where: { id: bookingId, taskerId } });
    if (exists === 0) throw new NotFoundException('Task not found');
  }

  private async lockOwnedBooking(
    taskerId: number,
    bookingId: number,
    transaction: Prisma.TransactionClient,
  ) {
    const rows = await transaction.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Bookings"
      WHERE "id" = ${bookingId} AND "taskerId" = ${taskerId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException('Task not found');
    return transaction.booking.findUniqueOrThrow({ where: { id: bookingId } });
  }

  private async lockSession(
    bookingId: number,
    transaction: Prisma.TransactionClient,
  ) {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "TaskWorkSessions" WHERE "bookingId" = ${bookingId} FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException('Task timer has not been started');
    return transaction.taskWorkSession.findUniqueOrThrow({ where: { bookingId } });
  }

  private timerView(
    bookingId: number,
    session:
      | {
          status: string;
          startedAt: Date;
          pausedAt: Date | null;
          accumulatedPausedSecs: number;
          stoppedAt: Date | null;
          notes: string | null;
        }
      | null,
  ): TaskTimerView {
    if (!session) {
      return {
        bookingId: String(bookingId),
        status: 'not_started',
        startedAt: null,
        pausedAt: null,
        stoppedAt: null,
        accumulatedPausedSeconds: 0,
        elapsedSeconds: 0,
        notes: '',
      };
    }
    const endpoint = session.stoppedAt ?? session.pausedAt ?? new Date();
    const elapsed = Math.max(
      0,
      Math.floor((endpoint.getTime() - session.startedAt.getTime()) / 1000) -
        session.accumulatedPausedSecs,
    );
    return {
      bookingId: String(bookingId),
      status: session.status as TaskTimerView['status'],
      startedAt: session.startedAt.toISOString(),
      pausedAt: toIso(session.pausedAt),
      stoppedAt: toIso(session.stoppedAt),
      accumulatedPausedSeconds: session.accumulatedPausedSecs,
      elapsedSeconds: elapsed,
      notes: session.notes ?? '',
    };
  }

  private serialize(booking: TaskerBookingWithRelations): TaskerTaskView {
    const hourly = Number(booking.hourlyRate);
    const estimated = estimatedTaskAmount(hourly, booking.startTime, booking.endTime);
    const currency = this.config.get<string>('taskerPayout.currency', 'USD').toUpperCase();
    return {
      id: String(booking.id),
      status: booking.status,
      date: dateOnlyFromDate(booking.bookingDate),
      startTime: booking.startTime,
      endTime: booking.endTime,
      hourlyRate: { amount: hourly, currency },
      estimatedPrice: { amount: estimated, currency },
      service: {
        id: String(booking.service.id),
        slug: booking.service.slug ?? '',
        name: booking.service.name ?? '',
        icon: booking.service.icon ?? '',
      },
      customer: {
        id: String(booking.customer.id),
        name: `${booking.customer.firstName ?? ''} ${booking.customer.lastName ?? ''}`.trim(),
        avatar: booking.customer.profilePicture ?? '',
        phoneCountryCode: booking.customer.phoneCountryCode ?? '',
        phoneNumber: booking.customer.phoneNumber ?? '',
      },
      location: {
        label: booking.locationLabel,
        venueAddress: booking.venueAddress,
        apartmentSuite: booking.apartmentSuite,
        lat: Number(booking.locationLat),
        lng: Number(booking.locationLng),
        city: booking.locationCity,
        area: booking.locationArea,
      },
      description: booking.description,
      attachments: safeJsonArray(booking.attachments),
      lifecycle: {
        confirmedAt: toIso(booking.confirmedAt),
        enRouteAt: toIso(booking.enRouteAt),
        arrivedAt: toIso(booking.arrivedAt),
        taskStartedAt: toIso(booking.taskStartedAt),
        taskCompletedAt: toIso(booking.taskCompletedAt),
        cancelledAt: toIso(booking.cancelledAt),
        cancellationReason: booking.cancellationReason,
      },
      actions: this.actions(booking.status, booking.workSession?.status ?? null),
    };
  }

  private actions(status: string, timerStatus: string | null): TaskActionView {
    return {
      confirm: status === TASKER_BOOKING_STATUS.Pending,
      cancel:
        !TERMINAL_TASK_STATUSES.has(status) && status !== TASKER_BOOKING_STATUS.InProgress,
      startNavigation: status === TASKER_BOOKING_STATUS.Confirmed,
      markArrived: status === TASKER_BOOKING_STATUS.EnRoute,
      startTimer:
        status === TASKER_BOOKING_STATUS.Arrived && timerStatus === null,
      pauseTimer:
        status === TASKER_BOOKING_STATUS.InProgress &&
        timerStatus === TASK_TIMER_STATUS.Running,
      resumeTimer:
        status === TASKER_BOOKING_STATUS.InProgress &&
        timerStatus === TASK_TIMER_STATUS.Paused,
      stopTimer:
        status === TASKER_BOOKING_STATUS.InProgress &&
        [TASK_TIMER_STATUS.Running, TASK_TIMER_STATUS.Paused].includes(
          timerStatus as never,
        ),
      complete:
        status === TASKER_BOOKING_STATUS.InProgress &&
        timerStatus === TASK_TIMER_STATUS.Stopped,
      messageCustomer: status !== TASKER_BOOKING_STATUS.Cancelled,
      reviewCustomer: status === TASKER_BOOKING_STATUS.Completed,
    };
  }
}
