import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import {
  ListConversationsQueryDto,
  ListMessagesQueryDto,
  SendMessageDto,
} from './conversations.dto';
import type {
  ConversationListView,
  ConversationMessageView,
  ConversationView,
  MessageListView,
  PersonSummaryView,
} from './conversations.types';

type ConversationBooking = Prisma.BookingGetPayload<{
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
    tasker: {
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
    messages: true;
  };
}>;

@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(
    userId: number,
    query: ListConversationsQueryDto,
  ): Promise<ConversationListView> {
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
        lastMessage: booking.messages[0]
          ? this.message(booking.messages[0], userId)
          : null,
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
    const [rows, totalItems] = await Promise.all([
      this.prisma.taskMessage.findMany({
        where: { bookingId },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
      }),
      this.prisma.taskMessage.count({ where: { bookingId } }),
    ]);

    return {
      bookingId: String(bookingId),
      otherParty: this.otherParty(booking, userId),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.reverse().map((row) => this.message(row, userId)),
    };
  }

  async send(
    userId: number,
    bookingId: number,
    dto: SendMessageDto,
  ): Promise<ConversationMessageView> {
    const hasBody = Boolean(dto.body?.trim());
    const attachments = dto.attachments ?? [];
    if (!hasBody && attachments.length === 0) {
      throw new BadRequestException('A message body or at least one attachment is required');
    }

    const booking = await this.requireParticipantBooking(userId, bookingId, false);
    const recipientId = booking.customerId === userId ? booking.taskerId : booking.customerId;
    const senderRole = booking.customerId === userId ? 'customer' : 'tasker';

    const created = await this.prisma.$transaction(async (transaction) => {
      const message = await transaction.taskMessage.create({
        data: {
          bookingId,
          senderId: userId,
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
          body: dto.body?.trim().slice(0, 220) || 'A new attachment was sent.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      return message;
    });

    return this.message(created, userId);
  }

  async markRead(userId: number, bookingId: number): Promise<{ updated: number }> {
    await this.requireParticipantBooking(userId, bookingId, false);
    const result = await this.prisma.taskMessage.updateMany({
      where: { bookingId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  private async requireParticipantBooking(
    userId: number,
    bookingId: number,
    summary: boolean,
  ): Promise<any> {
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
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
