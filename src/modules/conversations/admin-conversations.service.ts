import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import type { AdminListConversationsQueryDto, ListMessagesQueryDto } from './conversations.dto';

const PARTY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  profilePicture: true,
  phoneCountryCode: true,
  phoneNumber: true,
  accountStatus: true,
} as const;

type PartyRow = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  email: string;
  profilePicture: string | null;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  accountStatus: string;
};

type MessageRow = {
  id: string;
  conversationId: string;
  bookingId: number | null;
  senderId: number;
  body: string | null;
  attachments: unknown;
  kind?: string;
  event?: unknown;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * Read-only oversight of customer-tasker chat for administrators holding
 * conversations.read (Super Admin always). Admins never post into a thread and
 * reading never marks messages read for the participants. Opening a thread's
 * messages is written to the admin audit log.
 */
@Injectable()
export class AdminConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  async list(query: AdminListConversationsQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const numericSearch = search && /^\d+$/.test(search) ? Number(search) : null;
    const nameOrEmail = (field: 'customer' | 'tasker', term: string): Prisma.ConversationWhereInput[] => [
      { [field]: { firstName: { contains: term, mode: 'insensitive' } } },
      { [field]: { lastName: { contains: term, mode: 'insensitive' } } },
      { [field]: { email: { contains: term, mode: 'insensitive' } } },
    ];
    const where: Prisma.ConversationWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.taskerId ? { taskerId: query.taskerId } : {}),
      ...(query.bookingId ? { bookings: { some: { id: query.bookingId } } } : {}),
      ...(query.hasMessages === true ? { lastMessageAt: { not: null } } : {}),
      ...(search
        ? {
            OR: [
              ...nameOrEmail('customer', search),
              ...nameOrEmail('tasker', search),
              ...(numericSearch
                ? [{ customerId: numericSearch }, { taskerId: numericSearch }, { bookings: { some: { id: numericSearch } } }]
                : []),
              { messages: { some: { body: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.conversation.findMany({
        where,
        include: {
          customer: { select: PARTY_SELECT },
          tasker: { select: PARTY_SELECT },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          _count: { select: { messages: true, bookings: true } },
        },
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.conversation.count({ where }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        id: row.id,
        customer: this.party(row.customer, 'customer'),
        tasker: this.party(row.tasker, 'tasker'),
        messageCount: row._count.messages,
        bookingCount: row._count.bookings,
        lastMessageAt: row.lastMessageAt?.toISOString() ?? row.messages[0]?.createdAt.toISOString() ?? null,
        lastMessage: row.messages[0] ? this.message(row.messages[0], row) : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async detail(conversationId: string) {
    const conversation = await this.requireConversation(conversationId);
    const bookings = await this.prisma.booking.findMany({
      where: { conversationId },
      select: {
        id: true,
        status: true,
        paymentStatus: true,
        bookingDate: true,
        startTime: true,
        endTime: true,
        paymentCurrency: true,
        totalChargedAmount: true,
        service: { select: { id: true, name: true } },
        complaints: { select: { id: true, status: true, filedByRole: true, category: true, createdAt: true } },
      },
      orderBy: [{ bookingDate: 'desc' }, { id: 'desc' }],
    });
    return {
      id: conversation.id,
      customer: this.party(conversation.customer, 'customer'),
      tasker: this.party(conversation.tasker, 'tasker'),
      messageCount: conversation._count.messages,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
      bookings: bookings.map((booking) => ({
        id: String(booking.id),
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        date: booking.bookingDate.toISOString().slice(0, 10),
        startTime: booking.startTime,
        endTime: booking.endTime,
        service: { id: String(booking.service.id), name: booking.service.name ?? '' },
        total:
          booking.totalChargedAmount === null
            ? null
            : { amount: Number(booking.totalChargedAmount), currency: booking.paymentCurrency },
        disputes: booking.complaints.map((complaint) => ({
          id: complaint.id,
          status: complaint.status,
          filedByRole: complaint.filedByRole,
          category: complaint.category,
          createdAt: complaint.createdAt.toISOString(),
        })),
      })),
    };
  }

  async messages(actor: User, conversationId: string, query: ListMessagesQueryDto) {
    const conversation = await this.requireConversation(conversationId);
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 50);
    if (query.cursor) {
      const owned = await this.prisma.taskMessage.count({ where: { id: query.cursor, conversationId } });
      if (owned === 0) throw new BadRequestException('Message cursor is invalid');
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
    // First page only, so scrolling back through a long thread is one audit row, not dozens.
    if (!query.cursor && page === 1) {
      await this.audit.record({
        actorId: actor.id,
        action: 'conversation_viewed',
        entityType: 'conversation',
        entityId: conversationId,
        metadata: { customerId: conversation.customerId, taskerId: conversation.taskerId },
      });
    }
    return {
      conversationId,
      customer: this.party(conversation.customer, 'customer'),
      tasker: this.party(conversation.tasker, 'tasker'),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      nextCursor: hasMore ? (pageRows.at(-1)?.id ?? null) : null,
      hasMore,
      items: pageRows.reverse().map((row) => this.message(row, conversation)),
    };
  }

  private async requireConversation(conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        customer: { select: PARTY_SELECT },
        tasker: { select: PARTY_SELECT },
        _count: { select: { messages: true } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }

  private party(person: PartyRow, role: 'customer' | 'tasker') {
    return {
      id: String(person.id),
      role,
      name: `${person.firstName ?? ''} ${person.lastName ?? ''}`.trim(),
      email: person.email,
      avatar: person.profilePicture ?? '',
      phone: person.phoneNumber ? `${person.phoneCountryCode ?? ''}${person.phoneNumber}` : '',
      accountStatus: person.accountStatus,
    };
  }

  private message(row: MessageRow, conversation: { customerId: number; taskerId: number }) {
    return {
      id: row.id,
      conversationId: row.conversationId,
      bookingId: row.bookingId !== null ? String(row.bookingId) : null,
      senderId: String(row.senderId),
      senderRole: row.senderId === conversation.customerId ? 'customer' : row.senderId === conversation.taskerId ? 'tasker' : 'unknown',
      body: row.body ?? '',
      attachments: Array.isArray(row.attachments) ? row.attachments : [],
      kind: row.kind === 'system' ? 'system' : 'user',
      event: row.kind === 'system' && row.event && typeof row.event === 'object' ? (row.event as Record<string, unknown>) : null,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
