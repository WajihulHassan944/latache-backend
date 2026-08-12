import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
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
  SendMessageDto,
} from './conversations.dto';
import type {
  ConversationCapabilitiesView,
  ConversationListView,
  ConversationMessageView,
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

  async list(userId: number, query: ListConversationsQueryDto): Promise<ConversationListView> {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const where: Prisma.BookingWhereInput = {
      OR: [{ customerId: userId }, { taskerId: userId }],
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
        orderBy: { updatedAt: 'desc' },
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
        lastMessage: booking.messages[0] ? this.message(booking.messages[0], userId) : null,
        unreadCount: booking._count.messages,
      })),
    };
  }

  async summary(userId: number, bookingId: number): Promise<ConversationView> {
    const booking = await this.requireParticipantBooking(userId, bookingId, true);
    return {
      bookingId: String(booking.id),
      otherParty: this.otherParty(booking, userId),
      service: this.service(booking.service),
      bookingStatus: booking.status,
      lastMessage: booking.messages[0] ? this.message(booking.messages[0], userId) : null,
      unreadCount: booking._count.messages,
    };
  }

  async messages(
    userId: number,
    bookingId: number,
    query: ListMessagesQueryDto,
  ): Promise<MessageListView> {
    const booking = await this.requireParticipantBooking(userId, bookingId, false);
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
    userId: number,
    bookingId: number,
    query: ListConversationCallsQueryDto,
  ): Promise<ConversationCallListView> {
    return this.calls.list(userId, bookingId, query);
  }

  getCall(userId: number, bookingId: number, callId: string): Promise<ConversationCallView> {
    return this.calls.get(userId, bookingId, callId);
  }

  async send(user: User, bookingId: number, dto: SendMessageDto): Promise<ConversationMessageView> {
    const hasBody = Boolean(dto.body?.trim());
    const attachmentRequests = dto.attachments ?? [];
    if (!hasBody && attachmentRequests.length === 0) {
      throw new BadRequestException('A message body or at least one attachment is required');
    }

    const booking = await this.requireParticipantBooking(user.id, bookingId, false);
    const attachments = await this.uploads.verifyConversationAttachments(user, attachmentRequests);
    const recipientId = booking.customerId === user.id ? booking.taskerId : booking.customerId;
    const senderRole = booking.customerId === user.id ? 'customer' : 'tasker';

    const created = await this.prisma.$transaction(async (transaction) => {
      const message = await transaction.taskMessage.create({
        data: {
          bookingId,
          senderId: user.id,
          body: dto.body?.trim() || null,
          attachments:
            attachments.length > 0
              ? (attachments as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
        },
      });
      await this.notifications.create(
        recipientId,
        {
          category: 'messages',
          type: 'booking_message',
          title: `New message from your ${senderRole}`,
          body:
            dto.body?.trim().slice(0, 220) ||
            `${attachments.length} attachment${attachments.length === 1 ? '' : 's'} received.`,
          entityType: 'booking',
          entityId: String(bookingId),
          metadata:
            attachments.length > 0
              ? {
                  attachmentCount: attachments.length,
                  attachmentTypes: [...new Set(attachments.map((item) => item.mimeType))],
                }
              : undefined,
        },
        transaction,
      );
      await this.realtime.enqueueConversation(
        bookingId,
        'conversation:message',
        {
          id: message.id,
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
  }

  async markRead(userId: number, bookingId: number): Promise<{ updated: number }> {
    await this.requireParticipantBooking(userId, bookingId, false);
    return this.prisma.$transaction(async (transaction) => {
      const readAt = new Date();
      const result = await transaction.taskMessage.updateMany({
        where: { bookingId, senderId: { not: userId }, readAt: null },
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
          },
          transaction,
        );
      }
      return { updated: result.count };
    });
  }

  private async requireParticipantBooking(userId: number, bookingId: number, summary: boolean) {
    const booking = await this.prisma.booking.findFirst({
      where: {
        id: bookingId,
        OR: [{ customerId: userId }, { taskerId: userId }],
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
      body: string | null;
      attachments: unknown;
      readAt: Date | null;
      createdAt: Date;
    },
    viewerId: number,
  ): ConversationMessageView {
    return {
      id: row.id,
      bookingId: String(row.bookingId),
      senderId: String(row.senderId),
      isMine: row.senderId === viewerId,
      body: row.body ?? '',
      attachments: this.attachmentViews(row.attachments),
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
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
