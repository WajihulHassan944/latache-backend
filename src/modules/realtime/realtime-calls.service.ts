import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizePagination } from '../../common/utils/pagination.util';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { realtimeRoom } from './realtime.constants';
import type {
  CallActionPayload,
  CallInitiatePayload,
  ConversationCallListView,
  ConversationCallView,
  ListConversationCallsQuery,
  RealtimeSocketIdentity,
} from './realtime.types';

const ACTIVE_CALL_STATUSES = ['ringing', 'accepted'] as const;

const CALL_INCLUDE = {
  initiator: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
    },
  },
  recipient: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      profilePicture: true,
    },
  },
  booking: {
    select: {
      id: true,
      status: true,
      customerId: true,
      taskerId: true,
      service: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.ConversationCallInclude;

type CallRecord = Prisma.ConversationCallGetPayload<{
  include: typeof CALL_INCLUDE;
}>;

interface BookingParticipantRecord {
  id: number;
  status: string;
  customerId: number;
  taskerId: number;
  customer: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    accountStatus: string;
    deletedAt: Date | null;
    customerProfile: { status: string } | null;
  };
  tasker: {
    id: number;
    firstName: string | null;
    lastName: string | null;
    accountStatus: string;
    deletedAt: Date | null;
    taskerProfile: { status: string } | null;
  };
}

@Injectable()
export class RealtimeCallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  capabilities() {
    return {
      enabled: this.config.get<boolean>('chat.callsEnabled', true),
      provider: 'webrtc',
      mediaTransport: 'peer_to_peer',
      supportedTypes: ['voice', 'video'] as const,
      oneToOneOnly: true,
      recordingSupported: false,
      ringTimeoutSeconds: this.config.get<number>('chat.callRingTimeoutSeconds', 45),
      maxDurationSeconds: this.config.get<number>('chat.callMaxDurationSeconds', 14_400),
      allowedBookingStatuses: this.allowedBookingStatuses(),
      signaling: {
        persistedLifecycleEvents: ['call:incoming', 'call:state'],
        transientEvents: ['call:offer', 'call:answer', 'call:ice_candidate', 'call:media_state'],
      },
    };
  }

  async list(
    userId: number,
    bookingId: number,
    query: ListConversationCallsQuery,
    role: UserRole,
  ): Promise<ConversationCallListView> {
    await this.assertBookingParticipant(userId, bookingId, role);
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.ConversationCallWhereInput = {
      bookingId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.conversationCall.findMany({
        where,
        include: CALL_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.conversationCall.count({ where }),
    ]);
    return {
      bookingId: String(bookingId),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => this.toView(row, userId)),
    };
  }

  async get(userId: number, bookingId: number, callId: string, role: UserRole): Promise<ConversationCallView> {
    await this.assertBookingParticipant(userId, bookingId, role);
    const call = await this.prisma.conversationCall.findFirst({
      where: { id: callId, bookingId },
      include: CALL_INCLUDE,
    });
    if (!call) throw new NotFoundException('Call not found');
    return this.toView(call, userId);
  }

  async initiate(
    identity: RealtimeSocketIdentity,
    payload: CallInitiatePayload,
  ): Promise<ConversationCallView> {
    this.assertCallsEnabled();
    const booking = await this.requireParticipantBooking(identity.userId, payload.bookingId, identity.role);
    if (!this.allowedBookingStatuses().includes(booking.status)) {
      throw new ConflictException(
        `Calls are not available while the booking status is ${booking.status}`,
      );
    }

    const recipient = booking.customerId === identity.userId ? booking.tasker : booking.customer;
    const recipientRole = booking.customerId === recipient.id ? UserRole.Customer : UserRole.Tasker;
    const recipientProfileStatus =
      recipientRole === UserRole.Customer
        ? booking.customer.customerProfile?.status
        : booking.tasker.taskerProfile?.status;
    if (
      recipient.deletedAt ||
      [AccountStatus.Suspended, AccountStatus.Deactivated].includes(
        recipient.accountStatus as AccountStatus,
      ) ||
      recipientProfileStatus !== AccountStatus.Active
    ) {
      throw new ConflictException('The other booking participant cannot receive calls');
    }

    const existingIdempotent = await this.prisma.conversationCall.findUnique({
      where: {
        initiatorId_bookingId_clientRequestId: {
          initiatorId: identity.userId,
          bookingId: payload.bookingId,
          clientRequestId: payload.clientRequestId,
        },
      },
      include: CALL_INCLUDE,
    });
    if (existingIdempotent) {
      if (
        existingIdempotent.bookingId !== payload.bookingId ||
        existingIdempotent.type !== payload.type
      ) {
        throw new ConflictException('clientRequestId was already used for a different call');
      }
      return this.toView(existingIdempotent, identity.userId);
    }

    const participantIds = [identity.userId, recipient.id].sort((left, right) => left - right);

    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.get<number>('chat.callRingTimeoutSeconds', 45) * 1000,
    );

    try {
      const call = await this.prisma.$transaction(async (transaction) => {
        for (const participantId of participantIds) {
          await transaction.$executeRaw`
            SELECT pg_advisory_xact_lock(7313, CAST(${participantId} AS INTEGER))
          `;
        }
        const concurrentIdempotent = await transaction.conversationCall.findUnique({
          where: {
            initiatorId_bookingId_clientRequestId: {
              initiatorId: identity.userId,
              bookingId: payload.bookingId,
              clientRequestId: payload.clientRequestId,
            },
          },
          include: CALL_INCLUDE,
        });
        if (concurrentIdempotent) {
          if (
            concurrentIdempotent.bookingId !== payload.bookingId ||
            concurrentIdempotent.type !== payload.type
          ) {
            throw new ConflictException('clientRequestId was already used for a different call');
          }
          return concurrentIdempotent;
        }

        const busy = await transaction.conversationCall.findFirst({
          where: {
            status: { in: [...ACTIVE_CALL_STATUSES] },
            OR: [{ initiatorId: { in: participantIds } }, { recipientId: { in: participantIds } }],
          },
          select: { id: true },
        });
        if (busy) {
          throw new ConflictException('One of the participants is already in another call');
        }

        const created = await transaction.conversationCall.create({
          data: {
            bookingId: booking.id,
            initiatorId: identity.userId,
            recipientId: recipient.id,
            type: payload.type,
            clientRequestId: payload.clientRequestId,
            expiresAt,
          },
          include: CALL_INCLUDE,
        });

        const callerName = this.displayName(created.initiator);
        const notification = await transaction.taskNotification.create({
          data: {
            userId: recipient.id,
            audienceRole: recipientRole,
            category: 'messages',
            type: `incoming_${payload.type}_call`,
            title: `Incoming ${payload.type} call`,
            body: `${callerName} is calling you.`,
            entityType: 'conversation_call',
            entityId: created.id,
            metadata: {
              bookingId: String(created.bookingId),
              callType: created.type,
            },
          },
        });
        await this.enqueueUserRole(
          transaction,
          recipient.id,
          recipientRole,
          'notification:created',
          this.notificationPayload(notification),
        );
        await this.enqueueUser(
          transaction,
          recipient.id,
          'call:incoming',
          this.eventPayload(created),
        );
        await this.enqueueState(transaction, created);
        return created;
      });
      return this.toView(call, identity.userId);
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        throw new ConflictException('A call is already active for this booking');
      }
      throw error;
    }
  }

  async accept(
    identity: RealtimeSocketIdentity,
    payload: CallActionPayload,
  ): Promise<ConversationCallView> {
    this.assertCallsEnabled();
    const call = await this.requireCall(payload.callId);
    this.assertCallIdentityRole(identity, call);
    if (call.recipientId !== identity.userId) {
      throw new ForbiddenException('Only the call recipient can accept this call');
    }
    if (call.status === 'accepted') return this.toView(call, identity.userId);
    if (call.status !== 'ringing') throw new ConflictException('Call is no longer ringing');
    if (!this.allowedBookingStatuses().includes(call.booking.status)) {
      await this.finishSystemCall(call.id, 'cancelled', 'booking_status_changed');
      throw new GoneException('The booking no longer allows calls');
    }
    if (call.expiresAt.getTime() <= Date.now()) {
      await this.expireOneRingingCall(call.id);
      throw new GoneException('Call invitation has expired');
    }

    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.conversationCall.updateMany({
        where: { id: call.id, status: 'ringing' },
        data: { status: 'accepted', answeredAt: new Date() },
      });
      if (result.count !== 1) throw new ConflictException('Call is no longer ringing');
      const row = await transaction.conversationCall.findUniqueOrThrow({
        where: { id: call.id },
        include: CALL_INCLUDE,
      });
      await this.enqueueState(transaction, row);
      return row;
    });
    return this.toView(updated, identity.userId);
  }

  async reject(
    identity: RealtimeSocketIdentity,
    payload: CallActionPayload,
  ): Promise<ConversationCallView> {
    const call = await this.requireCall(payload.callId);
    this.assertCallIdentityRole(identity, call);
    if (call.recipientId !== identity.userId) {
      throw new ForbiddenException('Only the call recipient can reject this call');
    }
    return this.finishRinging(call, identity.userId, 'rejected', payload.reason ?? 'declined');
  }

  async cancel(
    identity: RealtimeSocketIdentity,
    payload: CallActionPayload,
  ): Promise<ConversationCallView> {
    const call = await this.requireCall(payload.callId);
    this.assertCallIdentityRole(identity, call);
    if (call.initiatorId !== identity.userId) {
      throw new ForbiddenException('Only the call initiator can cancel this call');
    }
    return this.finishRinging(
      call,
      identity.userId,
      'cancelled',
      payload.reason ?? 'caller_cancelled',
    );
  }

  async end(
    identity: RealtimeSocketIdentity,
    payload: CallActionPayload,
  ): Promise<ConversationCallView> {
    const call = await this.requireCall(payload.callId);
    this.assertCallIdentityRole(identity, call);
    this.assertCallParticipant(identity.userId, call);
    if (call.status === 'ended') return this.toView(call, identity.userId);
    if (call.status !== 'accepted')
      throw new ConflictException('Only an accepted call can be ended');

    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.conversationCall.updateMany({
        where: { id: call.id, status: 'accepted' },
        data: {
          status: 'ended',
          endedAt: new Date(),
          endedById: identity.userId,
          endReason: payload.reason ?? 'participant_ended',
        },
      });
      if (result.count !== 1) throw new ConflictException('Call has already ended');
      const row = await transaction.conversationCall.findUniqueOrThrow({
        where: { id: call.id },
        include: CALL_INCLUDE,
      });
      await this.enqueueState(transaction, row);
      return row;
    });
    return this.toView(updated, identity.userId);
  }

  async signalTarget(
    identity: RealtimeSocketIdentity,
    callId: string,
  ): Promise<{ call: CallRecord; targetUserId: number; targetRole: UserRole.Customer | UserRole.Tasker }> {
    this.assertCallsEnabled();
    const call = await this.requireCall(callId);
    this.assertCallIdentityRole(identity, call);
    this.assertCallParticipant(identity.userId, call);
    if (call.status !== 'accepted') {
      throw new ConflictException('WebRTC signaling is allowed only for an accepted call');
    }
    if (!this.allowedBookingStatuses().includes(call.booking.status)) {
      await this.finishSystemCall(call.id, 'ended', 'booking_status_changed');
      throw new GoneException('The booking no longer allows calls');
    }
    const targetUserId =
      call.initiatorId === identity.userId ? call.recipientId : call.initiatorId;
    return {
      call,
      targetUserId,
      targetRole:
        targetUserId === call.booking.customerId ? UserRole.Customer : UserRole.Tasker,
    };
  }

  async expireStaleCalls(): Promise<void> {
    const now = new Date();
    const ringing = await this.prisma.conversationCall.findMany({
      where: { status: 'ringing', expiresAt: { lte: now } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: 100,
    });
    for (const call of ringing) await this.expireOneRingingCall(call.id);

    const maximumDurationMs = this.config.get<number>('chat.callMaxDurationSeconds', 14_400) * 1000;
    const acceptedCutoff = new Date(now.getTime() - maximumDurationMs);
    const accepted = await this.prisma.conversationCall.findMany({
      where: {
        status: 'accepted',
        answeredAt: { not: null, lte: acceptedCutoff },
      },
      select: { id: true },
      orderBy: { answeredAt: 'asc' },
      take: 100,
    });
    for (const call of accepted) await this.expireAcceptedCall(call.id);
  }

  private async finishRinging(
    call: CallRecord,
    viewerId: number,
    status: 'rejected' | 'cancelled',
    reason: string,
  ): Promise<ConversationCallView> {
    if (call.status === status) return this.toView(call, viewerId);
    if (call.status !== 'ringing') throw new ConflictException('Call is no longer ringing');
    const updated = await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.conversationCall.updateMany({
        where: { id: call.id, status: 'ringing' },
        data: {
          status,
          endedAt: new Date(),
          endedById: viewerId,
          endReason: reason.slice(0, 120),
        },
      });
      if (result.count !== 1) throw new ConflictException('Call is no longer ringing');
      const row = await transaction.conversationCall.findUniqueOrThrow({
        where: { id: call.id },
        include: CALL_INCLUDE,
      });
      await this.enqueueState(transaction, row);
      return row;
    });
    return this.toView(updated, viewerId);
  }

  private async finishSystemCall(
    callId: string,
    status: 'cancelled' | 'ended',
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.conversationCall.updateMany({
        where: { id: callId, status: { in: [...ACTIVE_CALL_STATUSES] } },
        data: {
          status,
          endedAt: new Date(),
          endReason: reason.slice(0, 120),
        },
      });
      if (result.count !== 1) return;
      const call = await transaction.conversationCall.findUniqueOrThrow({
        where: { id: callId },
        include: CALL_INCLUDE,
      });
      await this.enqueueState(transaction, call);
    });
  }

  private async expireOneRingingCall(callId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.conversationCall.updateMany({
        where: { id: callId, status: 'ringing', expiresAt: { lte: new Date() } },
        data: {
          status: 'missed',
          endedAt: new Date(),
          endReason: 'no_answer',
        },
      });
      if (result.count !== 1) return;
      const call = await transaction.conversationCall.findUniqueOrThrow({
        where: { id: callId },
        include: CALL_INCLUDE,
      });
      const recipientRole =
        call.recipientId === call.booking.customerId ? UserRole.Customer : UserRole.Tasker;
      const notification = await transaction.taskNotification.create({
        data: {
          userId: call.recipientId,
          audienceRole: recipientRole,
          category: 'messages',
          type: `missed_${call.type}_call`,
          title: `Missed ${call.type} call`,
          body: `You missed a ${call.type} call from ${this.displayName(call.initiator)}.`,
          entityType: 'conversation_call',
          entityId: call.id,
          metadata: { bookingId: String(call.bookingId), callType: call.type },
        },
      });
      await this.enqueueUserRole(
        transaction,
        call.recipientId,
        recipientRole,
        'notification:created',
        this.notificationPayload(notification),
      );
      await this.enqueueState(transaction, call);
    });
  }

  private async expireAcceptedCall(callId: string): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.config.get<number>('chat.callMaxDurationSeconds', 14_400) * 1000,
    );
    await this.prisma.$transaction(async (transaction) => {
      const result = await transaction.conversationCall.updateMany({
        where: { id: callId, status: 'accepted', answeredAt: { lte: cutoff } },
        data: {
          status: 'ended',
          endedAt: new Date(),
          endReason: 'duration_limit',
        },
      });
      if (result.count !== 1) return;
      const call = await transaction.conversationCall.findUniqueOrThrow({
        where: { id: callId },
        include: CALL_INCLUDE,
      });
      await this.enqueueState(transaction, call);
    });
  }

  private async requireParticipantBooking(
    userId: number,
    bookingId: number,
    role: UserRole,
  ): Promise<BookingParticipantRecord> {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...this.participantBookingWhere(userId, role),
      },
      select: {
        id: true,
        status: true,
        customerId: true,
        taskerId: true,
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            accountStatus: true,
            deletedAt: true,
            customerProfile: { select: { status: true } },
          },
        },
        tasker: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            accountStatus: true,
            deletedAt: true,
            taskerProfile: { select: { status: true } },
          },
        },
      },
    });
    if (!booking) throw new NotFoundException('Conversation not found');
    return booking;
  }

  private async assertBookingParticipant(userId: number, bookingId: number, role: UserRole): Promise<void> {
    const count = await this.prisma.booking.count({
      where: { id: bookingId, ...this.participantBookingWhere(userId, role) },
    });
    if (!count) throw new NotFoundException('Conversation not found');
  }

  private async requireCall(callId: string): Promise<CallRecord> {
    const call = await this.prisma.conversationCall.findUnique({
      where: { id: callId },
      include: CALL_INCLUDE,
    });
    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

  private participantBookingWhere(userId: number, role: UserRole): Prisma.BookingWhereInput {
    if (role === UserRole.Customer) return { customerId: userId };
    if (role === UserRole.Tasker) return { taskerId: userId };
    return { id: -1 };
  }

  private assertCallIdentityRole(identity: RealtimeSocketIdentity, call: CallRecord): void {
    const matchesRole =
      (identity.role === UserRole.Customer && call.booking.customerId === identity.userId) ||
      (identity.role === UserRole.Tasker && call.booking.taskerId === identity.userId);
    if (!matchesRole) {
      throw new ForbiddenException('Call is not accessible from the active role');
    }
  }

  private assertCallParticipant(userId: number, call: CallRecord): void {
    if (call.initiatorId !== userId && call.recipientId !== userId) {
      throw new ForbiddenException('Call is not accessible');
    }
  }

  private assertCallsEnabled(): void {
    if (!this.config.get<boolean>('chat.callsEnabled', true)) {
      throw new ServiceUnavailableException('Voice and video calls are disabled');
    }
  }

  private allowedBookingStatuses(): string[] {
    return this.config.get<string[]>('chat.callAllowedBookingStatuses', [
      'confirmed',
      'en_route',
      'arrived',
      'in_progress',
    ]);
  }

  private async enqueueState(
    transaction: Prisma.TransactionClient,
    call: CallRecord,
  ): Promise<void> {
    const payload = this.eventPayload(call);
    await Promise.all([
      this.enqueueUserRole(
        transaction,
        call.initiatorId,
        call.initiatorId === call.booking.customerId ? UserRole.Customer : UserRole.Tasker,
        'call:state',
        payload,
      ),
      this.enqueueUserRole(
        transaction,
        call.recipientId,
        call.recipientId === call.booking.customerId ? UserRole.Customer : UserRole.Tasker,
        'call:state',
        payload,
      ),
    ]);
  }

  private enqueueUserRole(
    transaction: Prisma.TransactionClient,
    userId: number,
    role: UserRole,
    eventName: string,
    payload: Prisma.InputJsonValue,
  ) {
    return transaction.realtimeOutboxEvent.create({
      data: {
        room: realtimeRoom.userRole(userId, role),
        eventName,
        payload,
      },
    });
  }

  private enqueueUser(
    transaction: Prisma.TransactionClient,
    userId: number,
    eventName: string,
    payload: Prisma.InputJsonValue,
  ) {
    return transaction.realtimeOutboxEvent.create({
      data: {
        room: realtimeRoom.user(userId),
        eventName,
        payload,
      },
    });
  }

  private eventPayload(call: CallRecord): Prisma.InputJsonObject {
    return {
      id: call.id,
      bookingId: String(call.bookingId),
      type: call.type,
      status: call.status,
      initiatorId: String(call.initiatorId),
      recipientId: String(call.recipientId),
      initiator: this.personPayload(
        call.initiator,
        call.initiatorId === call.booking.customerId ? UserRole.Customer : UserRole.Tasker,
      ),
      recipient: this.personPayload(
        call.recipient,
        call.recipientId === call.booking.customerId ? UserRole.Customer : UserRole.Tasker,
      ),
      service: {
        id: String(call.booking.service.id),
        name: call.booking.service.name ?? '',
      },
      expiresAt: call.expiresAt.toISOString(),
      answeredAt: call.answeredAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      endReason: call.endReason,
      createdAt: call.createdAt.toISOString(),
      updatedAt: call.updatedAt.toISOString(),
    };
  }

  private toView(call: CallRecord, viewerId: number): ConversationCallView {
    const other = call.initiatorId === viewerId ? call.recipient : call.initiator;
    const durationSeconds = call.answeredAt
      ? Math.max(
          0,
          Math.floor(((call.endedAt ?? new Date()).getTime() - call.answeredAt.getTime()) / 1000),
        )
      : 0;
    return {
      id: call.id,
      bookingId: String(call.bookingId),
      type: call.type as 'voice' | 'video',
      status: call.status,
      initiatorId: String(call.initiatorId),
      recipientId: String(call.recipientId),
      isInitiator: call.initiatorId === viewerId,
      otherParty: {
        id: String(other.id),
        name: this.displayName(other),
        avatar: other.profilePicture ?? '',
        role: other.id === call.booking.customerId ? UserRole.Customer : UserRole.Tasker,
      },
      expiresAt: call.expiresAt.toISOString(),
      answeredAt: call.answeredAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      endReason: call.endReason,
      durationSeconds,
      createdAt: call.createdAt.toISOString(),
      updatedAt: call.updatedAt.toISOString(),
      actions: {
        accept: call.recipientId === viewerId && call.status === 'ringing',
        reject: call.recipientId === viewerId && call.status === 'ringing',
        cancel: call.initiatorId === viewerId && call.status === 'ringing',
        end: call.status === 'accepted',
      },
    };
  }

  private personPayload(
    person: {
      id: number;
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
    },
    role: UserRole.Customer | UserRole.Tasker,
  ): Prisma.InputJsonObject {
    return {
      id: String(person.id),
      name: this.displayName(person),
      avatar: person.profilePicture ?? '',
      role,
    };
  }

  private displayName(person: { firstName: string | null; lastName: string | null }): string {
    return `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim() || 'Latache user';
  }

  private notificationPayload(notification: {
    id: string;
    category: string;
    type: string;
    title: string;
    body: string;
    entityType: string | null;
    entityId: string | null;
    metadata: unknown;
    readAt: Date | null;
    createdAt: Date;
  }): Prisma.InputJsonObject {
    return {
      id: notification.id,
      category: notification.category,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      entityType: notification.entityType,
      entityId: notification.entityId,
      metadata: (notification.metadata ?? null) as Prisma.InputJsonValue,
      isRead: notification.readAt !== null,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
