import {
  BadRequestException,
  ConflictException,
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
  ConversationCapabilitiesView,
  ConversationListView,
  ConversationMessageView,
  ConversationReadResultView,
  ConversationUnreadCountView,
  ConversationView,
  MessageListView,
  PersonSummaryView,
} from './conversations.types';

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

  async list(user: User, query: ListConversationsQueryDto): Promise<ConversationListView> {
    const userId = user.id;
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const where: Prisma.BookingWhereInput = {
      ...this.participantBookingWhere(userId, user.role),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { customer: { firstName: { contains: search, mode: 'insensitive' } } },
                  { customer: { lastName: { contains: search, mode: 'insensitive' } } },
                  { tasker: { firstName: { contains: search, mode: 'insensitive' } } },
                  { tasker: { lastName: { contains: search, mode: 'insensitive' } } },
                  { service: { name: { contains: search, mode: 'insensitive' } } },
                ],
              },
            ],
          }
        : {}),
    };

    const [bookings, totalItems] = await Promise.all([
      this.prisma.booking.findMany({
        where,
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
          tasker: {
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
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: {
            select: {
              messages: { where: { senderId: { not: userId }, readAt: null } },
            },
          },
        },
        orderBy: [
          { conversationLastMessageAt: { sort: 'desc', nulls: 'last' } },
          { updatedAt: 'desc' },
          { id: 'desc' },
        ],
        skip: offset,
        take: limit,
      }),
      this.prisma.booking.count({ where }),
    ]);

    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: bookings.map((booking) => ({
        bookingId: String(booking.id),
        otherParty: this.otherParty(booking, userId),
        service: this.service(booking.service),
        bookingStatus: booking.status,
        lastMessageAt:
          booking.conversationLastMessageAt?.toISOString() ??
          booking.messages[0]?.createdAt.toISOString() ??
          null,
        lastMessage: booking.messages[0] ? this.message(booking.messages[0], userId) : null,
        unreadCount: booking._count.messages,
      })),
    };
  }

  async summary(user: User, bookingId: number): Promise<ConversationView> {
    const userId = user.id;
    const booking = await this.requireParticipantBooking(user, bookingId, true);
    return {
      bookingId: String(booking.id),
      otherParty: this.otherParty(booking, userId),
      service: this.service(booking.service),
      bookingStatus: booking.status,
      lastMessageAt:
        booking.conversationLastMessageAt?.toISOString() ??
        booking.messages[0]?.createdAt.toISOString() ??
        null,
      lastMessage: booking.messages[0] ? this.message(booking.messages[0], userId) : null,
      unreadCount: booking._count.messages,
    };
  }

  async unreadCount(user: User): Promise<ConversationUnreadCountView> {
    const userId = user.id;
    return {
      unreadCount: await this.prisma.taskMessage.count({
        where: {
          senderId: { not: userId },
          readAt: null,
          booking: this.participantBookingWhere(userId, user.role),
        },
      }),
    };
  }

  async messages(
    user: User,
    bookingId: number,
    query: ListMessagesQueryDto,
  ): Promise<MessageListView> {
    const userId = user.id;
    const booking = await this.requireParticipantBooking(user, bookingId, false);
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 50);
    if (query.cursor) {
      const cursorOwned = await this.prisma.taskMessage.count({
        where: { id: query.cursor, bookingId },
      });
      if (cursorOwned === 0) throw new BadRequestException('Message cursor is invalid');
    }
    const [rows, totalItems] = await Promise.all([
      this.prisma.taskMessage.findMany({
        where: { bookingId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : { skip: offset }),
        take: query.cursor ? limit + 1 : limit,
      }),
      this.prisma.taskMessage.count({ where: { bookingId } }),
    ]);
    const hasMore = query.cursor ? rows.length > limit : offset + rows.length < totalItems;
    const pageRows = rows.slice(0, limit);

    return {
      bookingId: String(bookingId),
      otherParty: this.otherParty(booking, userId),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
      hasMore,
      items: pageRows.reverse().map((row) => this.message(row, userId)),
    };
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

  async send(user: User, bookingId: number, dto: SendMessageDto): Promise<ConversationMessageView> {
    const body = dto.body?.trim() || null;
    const hasBody = Boolean(body);
    const attachmentRequests = dto.attachments ?? [];
    if (!hasBody && attachmentRequests.length === 0) {
      throw new BadRequestException('A message body or at least one attachment is required');
    }

    const booking = await this.requireParticipantBooking(user, bookingId, false);
    if (dto.clientMessageId) {
      const existing = await this.prisma.taskMessage.findFirst({
        where: { senderId: user.id, bookingId, clientMessageId: dto.clientMessageId },
      });
      if (existing) {
        this.assertConversationRetryMatches(existing, bookingId, body, attachmentRequests);
        return this.message(existing, user.id);
      }
    }

    const attachments = await this.uploads.verifyConversationAttachments(user, attachmentRequests);
    const recipientId = booking.customerId === user.id ? booking.taskerId : booking.customerId;
    const senderRole = booking.customerId === user.id ? 'customer' : 'tasker';

    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const message = await transaction.taskMessage.create({
          data: {
            bookingId,
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
          UPDATE "Bookings"
          SET "conversationLastMessageAt" = CASE
            WHEN "conversationLastMessageAt" IS NULL
              OR "conversationLastMessageAt" < ${message.createdAt}
            THEN ${message.createdAt}
            ELSE "conversationLastMessageAt"
          END
          WHERE "id" = ${bookingId}
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
            entityType: 'booking',
            entityId: String(bookingId),
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
          bookingId,
          'conversation:message',
          {
            id: message.id,
            clientMessageId: message.clientMessageId,
            bookingId: String(message.bookingId),
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
          where: { senderId: user.id, bookingId, clientMessageId: dto.clientMessageId },
        });
        if (existing) {
          this.assertConversationRetryMatches(existing, bookingId, body, attachmentRequests);
          return this.message(existing, user.id);
        }
      }
      throw error;
    }
  }

  async markRead(
    user: User,
    bookingId: number,
    dto: MarkConversationReadDto,
  ): Promise<ConversationReadResultView> {
    const userId = user.id;
    await this.requireParticipantBooking(user, bookingId, false);
    return this.prisma.$transaction(async (transaction) => {
      const boundary = dto.throughMessageId
        ? await transaction.taskMessage.findFirst({
            where: { id: dto.throughMessageId, bookingId },
            select: { id: true, createdAt: true },
          })
        : null;
      if (dto.throughMessageId && !boundary) {
        throw new BadRequestException('throughMessageId is not part of this conversation');
      }
      const readAt = new Date();
      const result = await transaction.taskMessage.updateMany({
        where: {
          bookingId,
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
          bookingId,
          'conversation:read',
          {
            bookingId: String(bookingId),
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

  private async requireParticipantBooking(user: Pick<User, 'id' | 'role'>, bookingId: number, summary: boolean) {
    const userId = user.id;
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        ...this.participantBookingWhere(userId, user.role as UserRole),
      },
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
        tasker: {
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
        messages: summary ? { orderBy: { createdAt: 'desc' }, take: 1 } : false,
        ...(summary
          ? {
              _count: {
                select: {
                  messages: { where: { senderId: { not: userId }, readAt: null } },
                },
              },
            }
          : {}),
      },
    });
    if (!booking) throw new NotFoundException('Conversation not found');
    return booking;
  }

  private participantBookingWhere(userId: number, role: UserRole | string): Prisma.BookingWhereInput {
    if (role === UserRole.Customer) return { customerId: userId };
    if (role === UserRole.Tasker) return { taskerId: userId };
    return { id: -1 };
  }

  private otherParty(
    booking: {
      customerId: number;
      taskerId: number;
      customer: {
        id: number;
        firstName: string | null;
        lastName: string | null;
        profilePicture: string | null;
        phoneCountryCode: string | null;
        phoneNumber: string | null;
      };
      tasker: {
        id: number;
        firstName: string | null;
        lastName: string | null;
        profilePicture: string | null;
        phoneCountryCode: string | null;
        phoneNumber: string | null;
      };
    },
    userId: number,
  ): PersonSummaryView {
    const isCustomer = booking.customerId === userId;
    const person = isCustomer ? booking.tasker : booking.customer;
    return {
      id: String(person.id),
      name: `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim(),
      avatar: person.profilePicture ?? '',
      role: isCustomer ? 'tasker' : 'customer',
      phoneCountryCode: person.phoneCountryCode ?? '',
      phoneNumber: person.phoneNumber ?? '',
    };
  }

  private service(service: {
    id: number;
    name: string | null;
    slug: string | null;
    icon: string | null;
  }) {
    return {
      id: String(service.id),
      slug: service.slug ?? '',
      name: service.name ?? '',
      icon: service.icon ?? '',
    };
  }

  private message(
    row: {
      id: string;
      bookingId: number;
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
      bookingId: String(row.bookingId),
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
      bookingId: number;
      body: string | null;
      attachments: unknown;
    },
    bookingId: number,
    body: string | null,
    attachments: Array<{ publicId: string }>,
  ): void {
    const existingIds = this.attachmentViews(existing.attachments).map((item) => item.publicId);
    const requestedIds = attachments.map((item) => item.publicId);
    if (
      existing.bookingId !== bookingId ||
      existing.body !== body ||
      existingIds.length !== requestedIds.length ||
      existingIds.some((id, index) => id !== requestedIds[index])
    ) {
      throw new ConflictException({
        code: 'CLIENT_MESSAGE_ID_REUSED',
        message: 'clientMessageId was already used for a different booking message',
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
