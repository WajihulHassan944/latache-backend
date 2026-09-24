import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeCallsService } from '../realtime/realtime-calls.service';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import type { ConversationCallListView, ConversationCallView } from '../realtime/realtime.types';
import { dateOnlyFromDate } from '../../common/utils/date.util';
import { UploadsService } from '../uploads/uploads.service';
import type { ConversationAttachmentReference } from '../uploads/uploads.types';
import {
  ListConversationCallsQueryDto,
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  MarkConversationReadDto,
  SendMessageDto,
} from './conversations.dto';
import type {
  BookingSummaryView,
  ConversationCapabilitiesView,
  ConversationListView,
  ConversationMessageView,
  ConversationReadResultView,
  ConversationUnreadCountView,
  ConversationView,
  MessageListView,
  PersonSummaryView,
} from './conversations.types';

const ACTIVE_BOOKING_STATUSES = [
  'pending',
  'awaiting_payment',
  'confirmed',
  'en_route',
  'arrived',
  'in_progress',
  'awaiting_customer_approval',
];

const PERSON_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  profilePicture: true,
  phoneCountryCode: true,
  phoneNumber: true,
  lastSeenAt: true,
} as const;

type PersonRow = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  profilePicture: string | null;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  lastSeenAt: Date | null;
};

type BookingSummaryRow = {
  id: number;
  status: string;
  service: { id: number; name: string | null; slug: string | null; icon: string | null };
  serviceOption: { id: number; name: string; slug: string } | null;
  bookingDate: Date;
  startTime: string;
  endTime: string;
  estimatedDurationMinutes: number;
  venueAddress: string;
  apartmentSuite: string | null;
  locationLabel: string;
  locationLat: Prisma.Decimal;
  locationLng: Prisma.Decimal;
  locationCity: string | null;
  locationArea: string | null;
  hourlyRate: Prisma.Decimal;
  paymentCurrency: string;
  totalChargedAmount: Prisma.Decimal | null;
  paymentStatus: string;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  rescheduledAt: Date | null;
  cancelledByRole: string | null;
  cancellationReason: string | null;
  rescheduleProposals: {
    id: string;
    proposedByRole: string;
    proposedDate: Date;
    proposedTime: string;
    note: string | null;
    createdAt: Date;
  }[];
};

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeOutboxService,
    private readonly uploads: UploadsService,
    private readonly calls: RealtimeCallsService,
  ) {}

  capabilities(): ConversationCapabilitiesView {
    const calls = this.calls.capabilities();
    return {
      attachments: this.uploads.conversationAttachmentCapabilities(),
      calls: {
        ...calls,
        sessionEndpoint: '/api/realtime/session',
        listHistoryEndpoint: '/api/conversations/:bookingId/calls',
        detailEndpoint: '/api/conversations/:bookingId/calls/:callId',
      },
    };
  }

  /** Find-or-create the single Conversation for a (customerId, taskerId) pair. Booking creation
   * resolves/creates through this so every booking always belongs to a conversation. */
  async findOrCreateConversation(
    customerId: number,
    taskerId: number,
    transaction?: Prisma.TransactionClient,
  ): Promise<{ id: string }> {
    const client = transaction ?? this.prisma;
    const existing = await client.conversation.findUnique({
      where: { customerId_taskerId: { customerId, taskerId } },
      select: { id: true },
    });
    if (existing) return existing;
    try {
      return await client.conversation.create({ data: { customerId, taskerId }, select: { id: true } });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002')) {
        const raced = await client.conversation.findUnique({
          where: { customerId_taskerId: { customerId, taskerId } },
          select: { id: true },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  async list(user: User, query: ListConversationsQueryDto): Promise<ConversationListView> {
    const userId = user.id;
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const where: Prisma.ConversationWhereInput = {
      ...this.participantConversationWhere(userId, user.role),
      ...(search
        ? {
            OR: [
              { customer: { firstName: { contains: search, mode: 'insensitive' } } },
              { customer: { lastName: { contains: search, mode: 'insensitive' } } },
              { tasker: { firstName: { contains: search, mode: 'insensitive' } } },
              { tasker: { lastName: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [conversations, totalItems] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          customer: { select: PERSON_SELECT },
          tasker: { select: PERSON_SELECT },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { messages: { where: { senderId: { not: userId }, readAt: null } } } },
        },
        orderBy: [
          { lastMessageAt: { sort: 'desc', nulls: 'last' } },
          { updatedAt: 'desc' },
          { id: 'desc' },
        ],
        skip: offset,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);

    const buckets = await this.loadBookingBuckets(conversations.map((row) => row.id));

    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: conversations.map((row) => this.conversationView(row, userId, buckets.get(row.id))),
    };
  }

  async unreadCount(user: User): Promise<ConversationUnreadCountView> {
    const userId = user.id;
    return {
      unreadCount: await this.prisma.taskMessage.count({
        where: {
          senderId: { not: userId },
          readAt: null,
          conversation: this.participantConversationWhere(userId, user.role),
        },
      }),
    };
  }

  async summaryByConversationId(user: User, conversationId: string): Promise<ConversationView> {
    const conversation = await this.requireParticipantConversation(user, conversationId, true);
    const buckets = await this.loadBookingBuckets([conversationId]);
    return this.conversationView(conversation, user.id, buckets.get(conversationId));
  }

  async summaryWithUser(user: User, otherUserId: number): Promise<ConversationView> {
    const pair = await this.resolveOtherUserRole(user, otherUserId);
    const conversation = await this.prisma.conversation.findUnique({
      where: { customerId_taskerId: pair },
      include: {
        customer: { select: PERSON_SELECT },
        tasker: { select: PERSON_SELECT },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: { where: { senderId: { not: user.id }, readAt: null } } } },
      },
    });
    if (!conversation) return this.emptyConversationView(user, pair, otherUserId);
    const buckets = await this.loadBookingBuckets([conversation.id]);
    return this.conversationView(conversation, user.id, buckets.get(conversation.id));
  }

  async messagesByConversationId(
    user: User,
    conversationId: string,
    query: ListMessagesQueryDto,
  ): Promise<MessageListView> {
    const userId = user.id;
    const conversation = await this.requireParticipantConversation(user, conversationId, false);
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 50);
    if (query.cursor) {
      const cursorOwned = await this.prisma.taskMessage.count({
        where: { id: query.cursor, conversationId },
      });
      if (cursorOwned === 0) throw new BadRequestException('Message cursor is invalid');
    }
    const [rows, totalItems] = await Promise.all([
      this.prisma.taskMessage.findMany({
        where: { conversationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : { skip: offset }),
        take: query.cursor ? limit + 1 : limit,
      }),
      this.prisma.taskMessage.count({ where: { conversationId } }),
    ]);
    const hasMore = query.cursor ? rows.length > limit : offset + rows.length < totalItems;
    const pageRows = rows.slice(0, limit);
    const buckets = await this.loadBookingBuckets([conversationId]);
    const bucket = buckets.get(conversationId);

    return {
      conversationId,
      otherParty: this.otherParty(conversation, userId),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
      hasMore,
      items: pageRows.reverse().map((row) => this.message(row, userId)),
      activeBooking: bucket?.activeBooking ? this.bookingSummary(bucket.activeBooking) : null,
      bookingHistory: (bucket?.bookingHistory ?? []).map((row) => this.bookingSummary(row)),
    };
  }

  async messagesWithUser(
    user: User,
    otherUserId: number,
    query: ListMessagesQueryDto,
  ): Promise<MessageListView> {
    const pair = await this.resolveOtherUserRole(user, otherUserId);
    const conversation = await this.prisma.conversation.findUnique({ where: { customerId_taskerId: pair } });
    if (!conversation) {
      const { page, limit } = normalizePagination(query.page, query.limit, 50);
      const other = await this.prisma.user.findUniqueOrThrow({ where: { id: otherUserId }, select: PERSON_SELECT });
      return {
        conversationId: null,
        otherParty: this.personSummary(other, user.id === pair.customerId ? 'tasker' : 'customer'),
        page,
        limit,
        totalItems: 0,
        totalPages: 0,
        nextCursor: null,
        hasMore: false,
        items: [],
        activeBooking: null,
        bookingHistory: [],
      };
    }
    return this.messagesByConversationId(user, conversation.id, query);
  }

  listCalls(
    user: User,
    bookingId: number,
    query: ListConversationCallsQueryDto,
  ): Promise<ConversationCallListView> {
    return this.calls.list(user.id, bookingId, query, user.role as UserRole);
  }

  getCall(user: User, bookingId: number, callId: string): Promise<ConversationCallView> {
    return this.calls.get(user.id, bookingId, callId, user.role as UserRole);
  }

  async sendToUser(user: User, otherUserId: number, dto: SendMessageDto): Promise<ConversationMessageView> {
    const pair = await this.resolveOtherUserRole(user, otherUserId);
    const conversation = await this.findOrCreateConversation(pair.customerId, pair.taskerId);
    return this.sendMessage(user, conversation.id, dto);
  }

  async sendMessage(user: User, conversationId: string, dto: SendMessageDto): Promise<ConversationMessageView> {
    const body = dto.body?.trim() || null;
    const hasBody = Boolean(body);
    const attachmentRequests = dto.attachments ?? [];
    if (!hasBody && attachmentRequests.length === 0) {
      throw new BadRequestException('A message body or at least one attachment is required');
    }

    const conversation = await this.requireParticipantConversation(user, conversationId, false);
    if (dto.clientMessageId) {
      const existing = await this.prisma.taskMessage.findFirst({
        where: { senderId: user.id, conversationId, clientMessageId: dto.clientMessageId },
      });
      if (existing) {
        this.assertConversationRetryMatches(existing, conversationId, body, attachmentRequests);
        return this.message(existing, user.id);
      }
    }

    const attachments = await this.uploads.verifyConversationAttachments(user, attachmentRequests);
    const recipientId = conversation.customerId === user.id ? conversation.taskerId : conversation.customerId;
    const senderRole = conversation.customerId === user.id ? 'customer' : 'tasker';

    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const activeBooking = await transaction.booking.findFirst({
          where: { conversationId, status: { in: ACTIVE_BOOKING_STATUSES } },
          orderBy: [{ bookingDate: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        const message = await transaction.taskMessage.create({
          data: {
            conversationId,
            bookingId: activeBooking?.id ?? null,
            senderId: user.id,
            clientMessageId: dto.clientMessageId ?? null,
            body,
            attachments:
              attachments.length > 0
                ? (attachments as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
          },
        });
        await transaction.$executeRaw`
          UPDATE "Conversations"
          SET "lastMessageAt" = CASE
            WHEN "lastMessageAt" IS NULL OR "lastMessageAt" < ${message.createdAt}
            THEN ${message.createdAt}
            ELSE "lastMessageAt"
          END
          WHERE "id" = ${conversationId}
        `;
        await this.notifications.create(
          recipientId,
          {
            category: 'messages',
            type: 'booking_message',
            title: `New message from your ${senderRole}`,
            body:
              body?.slice(0, 220) ||
              `${attachments.length} attachment${attachments.length === 1 ? '' : 's'} received.`,
            entityType: 'conversation',
            entityId: conversationId,
            metadata: {
              messageId: message.id,
              ...(dto.clientMessageId ? { clientMessageId: dto.clientMessageId } : {}),
              ...(attachments.length > 0
                ? {
                    attachmentCount: attachments.length,
                    attachmentTypes: [...new Set(attachments.map((item) => item.mimeType))],
                  }
                : {}),
            },
          },
          transaction,
        );
        await this.realtime.enqueueConversation(
          conversationId,
          'conversation:message',
          {
            id: message.id,
            clientMessageId: message.clientMessageId,
            conversationId,
            bookingId: message.bookingId !== null ? String(message.bookingId) : null,
            senderId: String(message.senderId),
            body: message.body ?? '',
            attachments: attachments as unknown as Prisma.InputJsonArray,
            readAt: null,
            createdAt: message.createdAt.toISOString(),
          },
          transaction,
        );
        return message;
      });

      return this.message(created, user.id);
    } catch (error) {
      if (dto.clientMessageId && hasPrismaErrorCode(error, 'P2002')) {
        const existing = await this.prisma.taskMessage.findFirst({
          where: { senderId: user.id, conversationId, clientMessageId: dto.clientMessageId },
        });
        if (existing) {
          this.assertConversationRetryMatches(existing, conversationId, body, attachmentRequests);
          return this.message(existing, user.id);
        }
      }
      throw error;
    }
  }

  async markRead(
    user: User,
    conversationId: string,
    dto: MarkConversationReadDto,
  ): Promise<ConversationReadResultView> {
    const userId = user.id;
    await this.requireParticipantConversation(user, conversationId, false);
    return this.prisma.$transaction(async (transaction) => {
      const boundary = dto.throughMessageId
        ? await transaction.taskMessage.findFirst({
            where: { id: dto.throughMessageId, conversationId },
            select: { id: true, createdAt: true },
          })
        : null;
      if (dto.throughMessageId && !boundary) {
        throw new BadRequestException('throughMessageId is not part of this conversation');
      }
      const readAt = new Date();
      const result = await transaction.taskMessage.updateMany({
        where: {
          conversationId,
          senderId: { not: userId },
          readAt: null,
          ...(boundary
            ? {
                OR: [
                  { createdAt: { lt: boundary.createdAt } },
                  { createdAt: boundary.createdAt, id: { lte: boundary.id } },
                ],
              }
            : {}),
        },
        data: { readAt },
      });
      if (result.count > 0) {
        await this.realtime.enqueueConversation(
          conversationId,
          'conversation:read',
          {
            conversationId,
            readerId: String(userId),
            updated: result.count,
            readAt: readAt.toISOString(),
            throughMessageId: boundary?.id ?? null,
          },
          transaction,
        );
      }
      return {
        updated: result.count,
        readAt: result.count > 0 ? readAt.toISOString() : null,
        throughMessageId: boundary?.id ?? null,
      };
    });
  }

  private async requireParticipantConversation(
    user: Pick<User, 'id' | 'role'>,
    conversationId: string,
    summary: boolean,
  ) {
    const userId = user.id;
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ...this.participantConversationWhere(userId, user.role as UserRole),
      },
      include: {
        customer: { select: PERSON_SELECT },
        tasker: { select: PERSON_SELECT },
        messages: summary ? { orderBy: { createdAt: 'desc' }, take: 1 } : false,
        ...(summary
          ? { _count: { select: { messages: { where: { senderId: { not: userId }, readAt: null } } } } }
          : {}),
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  /** Resolves which side of the (customerId, taskerId) pair the caller and the target user are on.
   * The caller's own active role decides their side; the target must hold the complementary role. */
  private async resolveOtherUserRole(
    user: Pick<User, 'id' | 'role'>,
    otherUserId: number,
  ): Promise<{ customerId: number; taskerId: number }> {
    if (otherUserId === user.id) {
      throw new BadRequestException('Cannot start a conversation with yourself');
    }
    const role = user.role as UserRole;
    const requiredOtherRole =
      role === UserRole.Customer ? UserRole.Tasker : role === UserRole.Tasker ? UserRole.Customer : null;
    if (!requiredOtherRole) {
      throw new ForbiddenException('Only customers and taskers can use conversations');
    }
    const other = await this.prisma.user.findFirst({
      where: { id: otherUserId, deletedAt: null, roles: { has: requiredOtherRole }, accountStatus: 'active' },
      select: { id: true },
    });
    if (!other) throw new NotFoundException('User not found');
    return role === UserRole.Customer
      ? { customerId: user.id, taskerId: otherUserId }
      : { customerId: otherUserId, taskerId: user.id };
  }

  private async emptyConversationView(
    user: Pick<User, 'id'>,
    pair: { customerId: number; taskerId: number },
    otherUserId: number,
  ): Promise<ConversationView> {
    const other = await this.prisma.user.findUniqueOrThrow({ where: { id: otherUserId }, select: PERSON_SELECT });
    return {
      id: null,
      otherParty: this.personSummary(other, user.id === pair.customerId ? 'tasker' : 'customer'),
      lastMessageAt: null,
      lastMessage: null,
      unreadCount: 0,
      activeBooking: null,
      bookingHistory: [],
    };
  }

  private participantConversationWhere(userId: number, role: UserRole | string): Prisma.ConversationWhereInput {
    if (role === UserRole.Customer) return { customerId: userId };
    if (role === UserRole.Tasker) return { taskerId: userId };
    return { customerId: -1 };
  }

  /** One query across every listed conversation, bucketed in-memory into the single most-recent
   * active booking (if any) plus every other booking as history, most recent first. */
  private async loadBookingBuckets(
    conversationIds: string[],
  ): Promise<Map<string, { activeBooking: BookingSummaryRow | null; bookingHistory: BookingSummaryRow[] }>> {
    const map = new Map<string, { activeBooking: BookingSummaryRow | null; bookingHistory: BookingSummaryRow[] }>();
    if (conversationIds.length === 0) return map;
    const bookings = await this.prisma.booking.findMany({
      where: { conversationId: { in: conversationIds } },
      include: {
        service: { select: { id: true, name: true, slug: true, icon: true } },
        serviceOption: { select: { id: true, name: true, slug: true } },
        rescheduleProposals: {
          where: { status: 'pending' },
          take: 1,
          select: { id: true, proposedByRole: true, proposedDate: true, proposedTime: true, note: true, createdAt: true },
        },
      },
      orderBy: [{ bookingDate: 'desc' }, { id: 'desc' }],
    });
    for (const booking of bookings) {
      const bucket = map.get(booking.conversationId) ?? { activeBooking: null, bookingHistory: [] };
      if (!bucket.activeBooking && ACTIVE_BOOKING_STATUSES.includes(booking.status)) {
        bucket.activeBooking = booking;
      } else {
        bucket.bookingHistory.push(booking);
      }
      map.set(booking.conversationId, bucket);
    }
    return map;
  }

  private conversationView(
    conversation: {
      id: string;
      customerId: number;
      taskerId: number;
      customer: PersonRow;
      tasker: PersonRow;
      lastMessageAt: Date | null;
      messages: {
        id: string;
        conversationId: string;
        bookingId: number | null;
        senderId: number;
        clientMessageId: string | null;
        body: string | null;
        attachments: unknown;
        readAt: Date | null;
        createdAt: Date;
      }[];
      _count: { messages: number };
    },
    userId: number,
    buckets: { activeBooking: BookingSummaryRow | null; bookingHistory: BookingSummaryRow[] } | undefined,
  ): ConversationView {
    return {
      id: conversation.id,
      otherParty: this.otherParty(conversation, userId),
      lastMessageAt:
        conversation.lastMessageAt?.toISOString() ?? conversation.messages[0]?.createdAt.toISOString() ?? null,
      lastMessage: conversation.messages[0] ? this.message(conversation.messages[0], userId) : null,
      unreadCount: conversation._count.messages,
      activeBooking: buckets?.activeBooking ? this.bookingSummary(buckets.activeBooking) : null,
      bookingHistory: (buckets?.bookingHistory ?? []).map((row) => this.bookingSummary(row)),
    };
  }

  private personSummary(person: PersonRow, role: 'customer' | 'tasker'): PersonSummaryView {
    return {
      id: String(person.id),
      name: `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim(),
      avatar: person.profilePicture ?? '',
      role,
      phoneCountryCode: person.phoneCountryCode ?? '',
      phoneNumber: person.phoneNumber ?? '',
      // Initial presence snapshot for a viewer who connects after the counterparty;
      // live presence:online/offline events refine it. null = never connected.
      lastSeenAt: person.lastSeenAt?.toISOString() ?? null,
    };
  }

  private otherParty(
    entity: { customerId: number; taskerId: number; customer: PersonRow; tasker: PersonRow },
    userId: number,
  ): PersonSummaryView {
    const isCustomer = entity.customerId === userId;
    const person = isCustomer ? entity.tasker : entity.customer;
    return this.personSummary(person, isCustomer ? 'tasker' : 'customer');
  }

  private service(service: { id: number; name: string | null; slug: string | null; icon: string | null }) {
    return {
      id: String(service.id),
      slug: service.slug ?? '',
      name: service.name ?? '',
      icon: service.icon ?? '',
    };
  }

  private bookingSummary(booking: BookingSummaryRow): BookingSummaryView {
    return {
      id: String(booking.id),
      status: booking.status,
      service: this.service(booking.service),
      serviceOption: booking.serviceOption
        ? { id: String(booking.serviceOption.id), name: booking.serviceOption.name, slug: booking.serviceOption.slug }
        : null,
      schedule: {
        date: dateOnlyFromDate(booking.bookingDate),
        startTime: booking.startTime,
        endTime: booking.endTime,
        estimatedDurationMinutes: booking.estimatedDurationMinutes,
      },
      location: {
        label: booking.locationLabel,
        lat: Number(booking.locationLat),
        lng: Number(booking.locationLng),
        city: booking.locationCity,
        area: booking.locationArea,
        venueAddress: booking.venueAddress,
        apartmentSuite: booking.apartmentSuite,
      },
      payment: {
        hourlyRate: Number(booking.hourlyRate),
        currency: booking.paymentCurrency,
        totalChargedAmount:
          booking.totalChargedAmount === null ? null : Number(booking.totalChargedAmount),
        paymentStatus: booking.paymentStatus,
      },
      createdAt: booking.createdAt.toISOString(),
      confirmedAt: booking.confirmedAt?.toISOString() ?? null,
      cancelledAt: booking.cancelledAt?.toISOString() ?? null,
      rescheduledAt: booking.rescheduledAt?.toISOString() ?? null,
      cancelledByRole: booking.status === 'cancelled' ? (booking.cancelledByRole as 'customer' | 'tasker' | 'system' | null) : null,
      cancellationReason: booking.status === 'cancelled' ? booking.cancellationReason : null,
      pendingRescheduleProposal: booking.rescheduleProposals[0]
        ? {
            id: booking.rescheduleProposals[0].id,
            proposedByRole: booking.rescheduleProposals[0].proposedByRole,
            proposedDate: dateOnlyFromDate(booking.rescheduleProposals[0].proposedDate),
            proposedTime: booking.rescheduleProposals[0].proposedTime,
            note: booking.rescheduleProposals[0].note,
            createdAt: booking.rescheduleProposals[0].createdAt.toISOString(),
          }
        : null,
    };
  }

  private message(
    row: {
      id: string;
      conversationId: string;
      bookingId: number | null;
      senderId: number;
      clientMessageId: string | null;
      body: string | null;
      attachments: unknown;
      readAt: Date | null;
      createdAt: Date;
    },
    viewerId: number,
  ): ConversationMessageView {
    return {
      id: row.id,
      clientMessageId: row.clientMessageId,
      conversationId: row.conversationId,
      bookingId: row.bookingId !== null ? String(row.bookingId) : null,
      senderId: String(row.senderId),
      isMine: row.senderId === viewerId,
      body: row.body ?? '',
      attachments: this.attachmentViews(row.attachments),
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private assertConversationRetryMatches(
    existing: {
      conversationId: string;
      body: string | null;
      attachments: unknown;
    },
    conversationId: string,
    body: string | null,
    attachments: Array<{ publicId: string }>,
  ): void {
    const existingIds = this.attachmentViews(existing.attachments).map((item) => item.publicId);
    const requestedIds = attachments.map((item) => item.publicId);
    if (
      existing.conversationId !== conversationId ||
      existing.body !== body ||
      existingIds.length !== requestedIds.length ||
      existingIds.some((id, index) => id !== requestedIds[index])
    ) {
      throw new ConflictException({
        code: 'CLIENT_MESSAGE_ID_REUSED',
        message: 'clientMessageId was already used for a different conversation message',
      });
    }
  }

  private attachmentViews(value: unknown): ConversationAttachmentReference[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is ConversationAttachmentReference => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      return (
        typeof record.publicId === 'string' &&
        typeof record.secureUrl === 'string' &&
        (record.resourceType === 'image' || record.resourceType === 'raw') &&
        typeof record.bytes === 'number' &&
        typeof record.originalFileName === 'string' &&
        typeof record.mimeType === 'string'
      );
    });
  }
}
