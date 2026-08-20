import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { SupportTicket, User } from '../../generated/prisma/client';
import { Prisma } from '../../generated/prisma/client';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import { UploadsService } from '../uploads/uploads.service';
import type {
  AdminSendSupportMessageDto,
  AdminSupportActionDto,
  AdminSupportQueryDto,
  CreateSupportTicketDto,
  ListOwnSupportTicketsQueryDto,
  ListSupportMessagesQueryDto,
  MarkSupportReadDto,
  SendSupportMessageDto,
  SupportFeedbackDto,
  SupportTicketUserActionDto,
} from './dto/support.dto';
import { ACTIVE_SUPPORT_STATUSES } from './support.constants';

const SUPPORT_USER_ROLES = new Set<string>([UserRole.Customer, UserRole.Tasker]);

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const durationMinutes = (from: Date | null, to: Date | null): number | null => {
  if (!from || !to) return null;
  return Math.max(0, Math.round(((to.getTime() - from.getTime()) / 60_000) * 100) / 100);
};

@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly realtime: RealtimeOutboxService,
    private readonly uploads: UploadsService,
  ) {}

  async capabilities() {
    const settings = await this.platformSettings.view('general');
    const general = settings.general as { liveChatEnabled?: boolean } | undefined;
    return {
      channels: ['ticket', 'live_chat'] as const,
      liveChatEnabled: general?.liveChatEnabled !== false,
      maxMessageLength: 5000,
      idempotency: {
        ticketCreationField: 'clientRequestId',
        messageField: 'clientMessageId',
        minLength: 8,
        maxLength: 80,
      },
      attachments: this.uploads.supportAttachmentCapabilities(),
      realtime: {
        namespace: '/realtime',
        path: '/socket.io',
        subscribeEvent: 'support:subscribe',
      },
    };
  }

  async create(user: User, dto: CreateSupportTicketDto) {
    this.assertSupportUser(user);
    if (dto.clientRequestId) {
      const existing = await this.prisma.supportTicket.findFirst({
        where: { userId: user.id, requesterRole: user.role, clientRequestId: dto.clientRequestId },
      });
      if (existing) {
        this.assertTicketRetryMatches(existing, dto);
        return this.detailForUser(user, existing.id);
      }
    }
    await this.assertLiveChatAvailable(dto.channel ?? 'ticket');
    await this.assertLinkedContext(user, dto);
    const attachments = await this.uploads.verifySupportAttachments(user, dto.attachments ?? []);

    const now = new Date();
    try {
      const ticket = await this.prisma.$transaction(async (transaction) => {
        const created = await transaction.supportTicket.create({
          data: {
            userId: user.id,
            requesterRole: user.role,
            clientRequestId: dto.clientRequestId ?? null,
            channel: dto.channel ?? 'ticket',
            subject: dto.subject,
            category: dto.category,
            priority: dto.priority ?? 'normal',
            status: 'open',
            description: dto.description,
            attachments: attachments.length
              ? (attachments as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            bookingId: dto.bookingId ?? null,
            referenceType: dto.referenceType ?? null,
            referenceId: dto.referenceId ?? null,
            lastMessageAt: now,
          },
        });
        const message = await transaction.supportTicketMessage.create({
          data: {
            ticketId: created.id,
            senderId: user.id,
            senderRole: user.role,
            clientMessageId: null,
            body: dto.description,
            attachments: attachments.length
              ? (attachments as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            isInternalNote: false,
          },
        });
        await this.realtime.enqueueSupportPublic(
          created.id,
          'support:message',
          this.supportMessageEvent(message),
          transaction,
        );
        await this.enqueueSupportTicketUpdated(created, transaction);
        await this.notifySupportTeam(
          created.id,
          `New ${created.channel === 'live_chat' ? 'live chat' : 'support ticket'} from ${this.userName(user)}`,
          dto.subject,
          transaction,
        );
        return created;
      });
      return this.detailForUser(user, ticket.id);
    } catch (error) {
      if (dto.clientRequestId && hasPrismaErrorCode(error, 'P2002')) {
        const existing = await this.prisma.supportTicket.findFirst({
          where: { userId: user.id, requesterRole: user.role, clientRequestId: dto.clientRequestId },
        });
        if (existing) {
          this.assertTicketRetryMatches(existing, dto);
          return this.detailForUser(user, existing.id);
        }
      }
      throw error;
    }
  }

  async listOwn(user: User, query: ListOwnSupportTicketsQueryDto) {
    this.assertSupportUser(user);
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.SupportTicketWhereInput = {
      userId: user.id,
      requesterRole: user.role,
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, totalItems] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          assignedAdmin: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
            },
          },
          _count: { select: { messages: true } },
        },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    const unreadByTicket = await this.unreadSupportMessagesByTicket(
      rows.map((row) => row.id),
      'user',
    );
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        ...this.serializeTicket(row),
        unreadCount: unreadByTicket.get(row.id) ?? 0,
      })),
    };
  }

  async unreadCountOwn(user: User): Promise<{ unreadCount: number }> {
    this.assertSupportUser(user);
    const unreadCount = await this.prisma.supportTicketMessage.count({
      where: {
        ticket: { userId: user.id, requesterRole: user.role },
        isInternalNote: false,
        senderRole: { in: [UserRole.Admin, UserRole.SuperAdmin] },
        readAt: null,
      },
    });
    return { unreadCount };
  }

  async detailForUser(user: User, ticketId: number) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId: user.id, requesterRole: user.role },
      include: {
        assignedAdmin: {
          select: { id: true, firstName: true, lastName: true, profilePicture: true },
        },
        booking: {
          include: {
            service: { select: { id: true, name: true, slug: true, icon: true } },
          },
        },
        _count: { select: { messages: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return {
      ...this.serializeTicket(ticket),
      description: ticket.description,
      attachments: Array.isArray(ticket.attachments) ? ticket.attachments : [],
      booking: ticket.booking
        ? {
            id: String(ticket.booking.id),
            status: ticket.booking.status,
            paymentStatus: ticket.booking.paymentStatus,
            bookingDate: ticket.booking.bookingDate.toISOString().slice(0, 10),
            startTime: ticket.booking.startTime,
            endTime: ticket.booking.endTime,
            service: {
              id: String(ticket.booking.service.id),
              name: ticket.booking.service.name,
              slug: ticket.booking.service.slug,
              icon: ticket.booking.service.icon ?? '',
            },
          }
        : null,
      reference: await this.referenceContext(ticket.referenceType, ticket.referenceId, user.id),
      feedback: ticket.feedbackAt
        ? {
            score: ticket.satisfactionScore,
            comment: ticket.feedbackComment,
            submittedAt: ticket.feedbackAt.toISOString(),
          }
        : null,
    };
  }

  async messagesOwn(user: User, ticketId: number, query: ListSupportMessagesQueryDto) {
    this.assertSupportUser(user);
    await this.requireOwnedTicket(user.id, ticketId, user.role);
    const result = await this.supportMessagePage(ticketId, query, false);
    return result.response;
  }

  async markReadOwn(user: User, ticketId: number, dto: MarkSupportReadDto) {
    this.assertSupportUser(user);
    await this.requireOwnedTicket(user.id, ticketId, user.role);
    return this.markSupportMessagesRead(ticketId, 'user', user.id, dto.throughMessageId);
  }

  async sendOwn(user: User, ticketId: number, dto: SendSupportMessageDto) {
    this.assertSupportUser(user);
    this.assertMessage(dto.body, dto.attachments?.length ?? 0);
    await this.requireOwnedTicket(user.id, ticketId, user.role);
    if (dto.clientMessageId) {
      const existing = await this.prisma.supportTicketMessage.findFirst({
        where: { senderId: user.id, ticketId, clientMessageId: dto.clientMessageId },
      });
      if (existing) {
        this.assertSupportMessageRetryMatches(existing, ticketId, dto, false);
        return this.serializeMessageWithUser(existing, user);
      }
    }
    const attachments = await this.uploads.verifySupportAttachments(user, dto.attachments ?? []);
    try {
      const created = await this.prisma.$transaction(async (transaction) => {
        const lockedTicket = await this.lockSupportTicket(transaction, ticketId, user.id, user.role);
        if (lockedTicket.status === 'closed' || lockedTicket.status === 'resolved') {
          throw new ConflictException('Reopen the ticket before sending another message');
        }
        const message = await transaction.supportTicketMessage.create({
          data: {
            ticketId,
            senderId: user.id,
            senderRole: user.role,
            clientMessageId: dto.clientMessageId ?? null,
            body: dto.body?.trim() || null,
            attachments: attachments.length
              ? (attachments as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          },
        });
        const updatedTicket = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            lastMessageAt: new Date(),
            ...(lockedTicket.status === 'waiting'
              ? {
                  status: lockedTicket.assignedAdminId ? 'in_progress' : 'open',
                  waitingSince: null,
                }
              : {}),
          },
        });
        await this.realtime.enqueueSupportPublic(
          ticketId,
          'support:message',
          this.supportMessageEvent(message),
          transaction,
        );
        await this.enqueueSupportTicketUpdated(updatedTicket, transaction);
        if (lockedTicket.assignedAdminId) {
          await this.notifications.create(
            lockedTicket.assignedAdminId,
            {
              category: 'system',
              type: 'support_user_reply',
              title: `${this.ticketNumber(ticketId)} has a new reply`,
              body: dto.body?.trim().slice(0, 220) || 'The user sent a support attachment.',
              entityType: 'support_ticket',
              entityId: String(ticketId),
            },
            transaction,
          );
        } else {
          await this.notifySupportTeam(
            ticketId,
            `${this.ticketNumber(ticketId)} has a new reply`,
            dto.body?.trim().slice(0, 220) || 'The user sent a support attachment.',
            transaction,
          );
        }
        return message;
      });
      return this.serializeMessageWithUser(created, user);
    } catch (error) {
      if (dto.clientMessageId && hasPrismaErrorCode(error, 'P2002')) {
        const existing = await this.prisma.supportTicketMessage.findFirst({
          where: { senderId: user.id, ticketId, clientMessageId: dto.clientMessageId },
        });
        if (existing) {
          this.assertSupportMessageRetryMatches(existing, ticketId, dto, false);
          return this.serializeMessageWithUser(existing, user);
        }
      }
      throw error;
    }
  }

  async userAction(user: User, ticketId: number, dto: SupportTicketUserActionDto) {
    this.assertSupportUser(user);
    await this.prisma.$transaction(async (transaction) => {
      const ticket = await this.lockSupportTicket(transaction, ticketId, user.id, user.role);
      if (dto.action === 'close') {
        if (ticket.status === 'closed') return;
        const updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: { status: 'closed', closedAt: new Date() },
        });
        await this.enqueueSupportTicketUpdated(updated, transaction);
        return;
      }
      if (!['resolved', 'closed'].includes(ticket.status)) {
        throw new ConflictException('Only resolved or closed tickets can be reopened');
      }
      const updated = await transaction.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: 'open',
          resolvedAt: null,
          resolutionSummary: null,
          closedAt: null,
          escalatedAt: null,
          escalationReason: null,
          waitingSince: null,
          reopenedCount: { increment: 1 },
          lastMessageAt: new Date(),
        },
      });
      await this.notifySupportTeam(
        ticketId,
        `${this.ticketNumber(ticketId)} was reopened`,
        `${this.userName(user)} reopened the support ticket.`,
        transaction,
      );
      await this.enqueueSupportTicketUpdated(updated, transaction);
    });
    return this.detailForUser(user, ticketId);
  }

  async feedback(user: User, ticketId: number, dto: SupportFeedbackDto) {
    this.assertSupportUser(user);
    await this.prisma.$transaction(async (transaction) => {
      const ticket = await this.lockSupportTicket(transaction, ticketId, user.id, user.role);
      if (!['resolved', 'closed'].includes(ticket.status)) {
        throw new ConflictException(
          'Feedback is available only after the support ticket is resolved',
        );
      }
      if (ticket.feedbackAt) {
        throw new ConflictException('Feedback has already been submitted for this ticket');
      }
      await transaction.supportTicket.update({
        where: { id: ticketId },
        data: {
          satisfactionScore: dto.score,
          feedbackComment: dto.comment ?? null,
          feedbackAt: new Date(),
        },
      });
    });
    return { submitted: true, score: dto.score };
  }

  async adminRead(query: AdminSupportQueryDto) {
    const view = query.view ?? 'support_tickets';
    if (view === 'reports') return this.reports(query);
    return this.adminTickets(query);
  }

  async adminCsv(query: AdminSupportQueryDto) {
    if ((query.view ?? 'support_tickets') !== 'reports') {
      throw new BadRequestException('CSV export is available for the resolution reports view');
    }
    const report = await this.reports({ ...query, format: 'json' });
    const lines = ['section,metric,value'];
    const summary = report.summary as Record<string, unknown>;
    for (const [metric, value] of Object.entries(summary)) {
      const rendered = value && typeof value === 'object' ? JSON.stringify(value) : value;
      lines.push(['summary', metric, rendered].map(csvCell).join(','));
    }
    for (const row of report.byCategory as Array<{
      category: string;
      count: number;
      percent: number;
    }>) {
      lines.push(
        ['category', row.category, `${row.count} (${row.percent}%)`].map(csvCell).join(','),
      );
    }
    for (const row of report.topAgents as Array<Record<string, unknown>>) {
      lines.push(['agent', row.name, JSON.stringify(row)].map(csvCell).join(','));
    }
    return {
      body: `${lines.join('\n')}\n`,
      filename: 'latache-support-resolution-report.csv',
    };
  }

  async adminDetail(ticketId: number) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profilePicture: true,
            role: true,
            accountStatus: true,
          },
        },
        assignedAdmin: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            profilePicture: true,
            role: true,
          },
        },
        booking: {
          include: {
            service: { select: { id: true, name: true, slug: true, icon: true } },
          },
        },
        messages: {
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profilePicture: true,
                role: true,
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 100,
        },
        _count: { select: { messages: true } },
      },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return {
      ...this.serializeTicket(ticket),
      description: ticket.description,
      attachments: Array.isArray(ticket.attachments) ? ticket.attachments : [],
      user: {
        id: String(ticket.user.id),
        name: this.userName(ticket.user),
        email: ticket.user.email,
        role: ticket.requesterRole,
        accountStatus: ticket.user.accountStatus,
        profilePicture: ticket.user.profilePicture ?? '',
      },
      booking: ticket.booking
        ? {
            id: String(ticket.booking.id),
            status: ticket.booking.status,
            paymentStatus: ticket.booking.paymentStatus,
            bookingDate: ticket.booking.bookingDate.toISOString().slice(0, 10),
            startTime: ticket.booking.startTime,
            endTime: ticket.booking.endTime,
            service: {
              id: String(ticket.booking.service.id),
              name: ticket.booking.service.name,
              slug: ticket.booking.service.slug,
              icon: ticket.booking.service.icon ?? '',
            },
          }
        : null,
      reference: await this.referenceContext(
        ticket.referenceType,
        ticket.referenceId,
        ticket.userId,
      ),
      messages: ticket.messages.reverse().map((message) => this.serializeMessage(message)),
      messageWindow: {
        returned: ticket.messages.length,
        total: ticket._count.messages,
        hasMore: ticket._count.messages > ticket.messages.length,
        nextCursor:
          ticket._count.messages > ticket.messages.length ? (ticket.messages[0]?.id ?? null) : null,
      },
      feedback: ticket.feedbackAt
        ? {
            score: ticket.satisfactionScore,
            comment: ticket.feedbackComment,
            submittedAt: ticket.feedbackAt.toISOString(),
          }
        : null,
    };
  }

  async adminMessages(ticketId: number, query: ListSupportMessagesQueryDto) {
    await this.requireTicket(ticketId);
    const result = await this.supportMessagePage(ticketId, query, true);
    return result.response;
  }

  async adminMarkRead(actor: User, ticketId: number, dto: MarkSupportReadDto) {
    await this.requireTicket(ticketId);
    return this.markSupportMessagesRead(ticketId, 'admin', actor.id, dto.throughMessageId);
  }

  async adminSend(actor: User, ticketId: number, dto: AdminSendSupportMessageDto) {
    this.assertMessage(dto.body, dto.attachments?.length ?? 0);
    await this.requireTicket(ticketId);
    const internalNote = dto.internalNote ?? false;
    if (dto.clientMessageId) {
      const existing = await this.prisma.supportTicketMessage.findFirst({
        where: { senderId: actor.id, ticketId, clientMessageId: dto.clientMessageId },
      });
      if (existing) {
        this.assertSupportMessageRetryMatches(existing, ticketId, dto, internalNote);
        return this.serializeMessageWithUser(existing, actor);
      }
    }
    const attachments = await this.uploads.verifySupportAttachments(actor, dto.attachments ?? []);
    const now = new Date();
    try {
      const message = await this.prisma.$transaction(async (transaction) => {
        const lockedTicket = await this.lockSupportTicket(transaction, ticketId);
        if (lockedTicket.status === 'closed') {
          throw new ConflictException('Closed tickets must be reopened before adding a message');
        }
        if (!internalNote && lockedTicket.status === 'resolved') {
          throw new ConflictException(
            'Resolved tickets must be reopened before sending a public reply',
          );
        }
        const created = await transaction.supportTicketMessage.create({
          data: {
            ticketId,
            senderId: actor.id,
            senderRole: actor.role,
            clientMessageId: dto.clientMessageId ?? null,
            body: dto.body?.trim() || null,
            attachments: attachments.length
              ? (attachments as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            isInternalNote: internalNote,
          },
        });
        const updatedTicket = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            lastMessageAt: now,
            ...(!internalNote && !lockedTicket.firstResponseAt ? { firstResponseAt: now } : {}),
            ...(!internalNote && ['open', 'waiting'].includes(lockedTicket.status)
              ? { status: 'in_progress', waitingSince: null }
              : {}),
            ...(!internalNote && !lockedTicket.assignedAdminId
              ? { assignedAdminId: actor.id }
              : {}),
          },
        });
        await (internalNote
          ? this.realtime.enqueueSupportAdmins(
              ticketId,
              'support:message',
              this.supportMessageEvent(created),
              transaction,
            )
          : this.realtime.enqueueSupportPublic(
              ticketId,
              'support:message',
              this.supportMessageEvent(created),
              transaction,
            ));
        await this.enqueueSupportTicketUpdated(
          updatedTicket,
          transaction,
          internalNote ? 'internal' : 'public',
        );
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: lockedTicket.userId,
            action: internalNote ? 'support_internal_note_added' : 'support_reply_sent',
            entityType: 'support_ticket',
            entityId: ticketId,
            metadata: { channel: lockedTicket.channel },
          },
          transaction,
        );
        if (!internalNote) {
          await this.notifications.create(
            lockedTicket.userId,
            {
              category: 'system',
              type: 'support_agent_reply',
              title: `${this.ticketNumber(ticketId)} has a new support reply`,
              body: dto.body?.trim().slice(0, 220) || 'Support sent an attachment.',
              entityType: 'support_ticket',
              entityId: String(ticketId),
            },
            transaction,
          );
        }
        return created;
      });
      return this.serializeMessageWithUser(message, actor);
    } catch (error) {
      if (dto.clientMessageId && hasPrismaErrorCode(error, 'P2002')) {
        const existing = await this.prisma.supportTicketMessage.findFirst({
          where: { senderId: actor.id, ticketId, clientMessageId: dto.clientMessageId },
        });
        if (existing) {
          this.assertSupportMessageRetryMatches(existing, ticketId, dto, internalNote);
          return this.serializeMessageWithUser(existing, actor);
        }
      }
      throw error;
    }
  }

  async adminAction(actor: User, ticketId: number, dto: AdminSupportActionDto) {
    if (dto.action === 'assign') {
      await this.assertSupportAdmin(dto.assignedAdminId ?? actor.id);
    }
    if (dto.action === 'set_priority' && !dto.priority) {
      throw new BadRequestException('priority is required for set_priority');
    }
    if (dto.action === 'escalate' && !dto.reason?.trim()) {
      throw new BadRequestException('reason is required to escalate a ticket');
    }
    if (dto.action === 'resolve' && !dto.resolutionSummary?.trim()) {
      throw new BadRequestException('resolutionSummary is required to resolve a ticket');
    }
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const ticket = await this.lockSupportTicket(transaction, ticketId);
      let updated: SupportTicket;

      if (dto.action === 'assign') {
        const targetId = dto.assignedAdminId ?? actor.id;
        updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            assignedAdminId: targetId,
            ...(ticket.status === 'open' ? { status: 'in_progress' } : {}),
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: ticket.userId,
            action: 'support_ticket_assigned',
            entityType: 'support_ticket',
            entityId: ticketId,
            metadata: { assignedAdminId: targetId },
          },
          transaction,
        );
        if (targetId !== actor.id) {
          await this.notifications.create(
            targetId,
            {
              category: 'system',
              type: 'support_ticket_assigned',
              title: `${this.ticketNumber(ticketId)} assigned to you`,
              body: ticket.subject,
              entityType: 'support_ticket',
              entityId: String(ticketId),
            },
            transaction,
          );
        }
      } else if (dto.action === 'unassign') {
        updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            assignedAdminId: null,
            ...(ticket.status === 'in_progress' ? { status: 'open' } : {}),
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: ticket.userId,
            action: 'support_ticket_unassigned',
            entityType: 'support_ticket',
            entityId: ticketId,
          },
          transaction,
        );
      } else if (dto.action === 'start' || dto.action === 'wait') {
        if (['resolved', 'closed'].includes(ticket.status)) {
          throw new ConflictException(
            dto.action === 'start'
              ? 'Resolved/closed tickets must be reopened before work resumes'
              : 'Resolved/closed tickets cannot enter waiting state',
          );
        }
        updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            status: dto.action === 'start' ? 'in_progress' : 'waiting',
            waitingSince: dto.action === 'start' ? null : now,
            assignedAdminId: ticket.assignedAdminId ?? actor.id,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: ticket.userId,
            action: dto.action === 'start' ? 'support_ticket_started' : 'support_ticket_waiting',
            entityType: 'support_ticket',
            entityId: ticketId,
          },
          transaction,
        );
      } else if (dto.action === 'set_priority') {
        if (!dto.priority) {
          throw new BadRequestException('priority is required for set_priority');
        }
        updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: { priority: dto.priority },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: ticket.userId,
            action: 'support_ticket_priority_changed',
            entityType: 'support_ticket',
            entityId: ticketId,
            metadata: { from: ticket.priority, to: dto.priority },
          },
          transaction,
        );
      } else if (dto.action === 'escalate') {
        if (['resolved', 'closed'].includes(ticket.status)) {
          throw new ConflictException('Resolved/closed tickets cannot be escalated');
        }
        const reason = dto.reason?.trim();
        if (!reason) throw new BadRequestException('reason is required to escalate a ticket');
        updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            status: 'escalated',
            priority: 'urgent',
            escalatedAt: now,
            escalationReason: reason,
            assignedAdminId: ticket.assignedAdminId ?? actor.id,
            waitingSince: null,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: ticket.userId,
            action: 'support_ticket_escalated',
            entityType: 'support_ticket',
            entityId: ticketId,
            reason,
          },
          transaction,
        );
        await this.notifications.create(
          ticket.userId,
          {
            category: 'system',
            type: 'support_ticket_escalated',
            title: `${this.ticketNumber(ticketId)} was escalated`,
            body: 'Your support request has been escalated for additional review.',
            entityType: 'support_ticket',
            entityId: String(ticketId),
          },
          transaction,
        );
      } else if (dto.action === 'resolve') {
        if (['resolved', 'closed'].includes(ticket.status)) {
          throw new ConflictException('Only active tickets can be resolved');
        }
        const resolutionSummary = dto.resolutionSummary?.trim();
        if (!resolutionSummary) {
          throw new BadRequestException('resolutionSummary is required to resolve a ticket');
        }
        updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            status: 'resolved',
            resolvedAt: now,
            resolutionSummary,
            assignedAdminId: ticket.assignedAdminId ?? actor.id,
            waitingSince: null,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: ticket.userId,
            action: 'support_ticket_resolved',
            entityType: 'support_ticket',
            entityId: ticketId,
            reason: resolutionSummary,
          },
          transaction,
        );
        await this.notifications.create(
          ticket.userId,
          {
            category: 'system',
            type: 'support_ticket_resolved',
            title: `${this.ticketNumber(ticketId)} was resolved`,
            body: resolutionSummary.slice(0, 220),
            entityType: 'support_ticket',
            entityId: String(ticketId),
          },
          transaction,
        );
      } else if (dto.action === 'close') {
        if (ticket.status !== 'resolved') {
          throw new ConflictException('Only resolved tickets can be closed by an administrator');
        }
        updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: { status: 'closed', closedAt: now },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: ticket.userId,
            action: 'support_ticket_closed',
            entityType: 'support_ticket',
            entityId: ticketId,
          },
          transaction,
        );
      } else {
        if (!['resolved', 'closed'].includes(ticket.status)) {
          throw new ConflictException('Only resolved or closed tickets can be reopened');
        }
        updated = await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            status: 'open',
            resolvedAt: null,
            resolutionSummary: null,
            closedAt: null,
            escalatedAt: null,
            escalationReason: null,
            waitingSince: null,
            reopenedCount: { increment: 1 },
            assignedAdminId: actor.id,
            lastMessageAt: now,
          },
        });
        await this.audit.record(
          {
            actorId: actor.id,
            targetUserId: ticket.userId,
            action: 'support_ticket_reopened',
            entityType: 'support_ticket',
            entityId: ticketId,
            reason: dto.reason,
          },
          transaction,
        );
      }
      await this.enqueueSupportTicketUpdated(updated, transaction);
    });
    return this.adminDetail(ticketId);
  }

  private async adminTickets(query: AdminSupportQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where = this.adminWhere(query);
    const [summary, rows, totalItems] = await Promise.all([
      this.summary(),
      this.prisma.supportTicket.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              role: true,
              email: true,
              profilePicture: true,
            },
          },
          assignedAdmin: {
            select: { id: true, firstName: true, lastName: true, profilePicture: true },
          },
          _count: { select: { messages: true } },
        },
        orderBy: [{ priority: 'desc' }, { lastMessageAt: 'desc' }],
        skip: offset,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);
    const unreadByTicket = await this.unreadSupportMessagesByTicket(
      rows.map((row) => row.id),
      'admin',
    );
    return {
      view: query.view ?? 'support_tickets',
      summary,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        ...this.serializeTicket(row),
        unreadCount: unreadByTicket.get(row.id) ?? 0,
        user: {
          id: String(row.user.id),
          name: this.userName(row.user),
          role: row.requesterRole,
          email: row.user.email,
          profilePicture: row.user.profilePicture ?? '',
        },
      })),
    };
  }

  private async reports(query: AdminSupportQueryDto) {
    const date = this.dateFilter(query);
    const resolvedWhere: Prisma.SupportTicketWhereInput = {
      resolvedAt: { not: null, ...(date ?? {}) },
    };
    const [summary, resolvedRows, categoryGroups] = await Promise.all([
      this.summary(),
      this.prisma.supportTicket.findMany({
        where: resolvedWhere,
        select: {
          id: true,
          category: true,
          assignedAdminId: true,
          createdAt: true,
          firstResponseAt: true,
          resolvedAt: true,
          satisfactionScore: true,
          reopenedCount: true,
          messages: {
            where: {
              isInternalNote: false,
              senderRole: { in: [UserRole.Admin, UserRole.SuperAdmin] },
            },
            select: { id: true },
          },
        },
        orderBy: { resolvedAt: 'asc' },
      }),
      this.prisma.supportTicket.groupBy({
        by: ['category'],
        where: { createdAt: date ?? undefined },
        _count: true,
      }),
    ]);

    const resolutionMinutes = resolvedRows
      .map((row) => durationMinutes(row.createdAt, row.resolvedAt))
      .filter((value): value is number => value !== null);
    const responseMinutes = resolvedRows
      .map((row) => durationMinutes(row.createdAt, row.firstResponseAt))
      .filter((value): value is number => value !== null);
    const csatScores = resolvedRows
      .map((row) => row.satisfactionScore)
      .filter((value): value is number => value !== null);
    const fcrCount = resolvedRows.filter(
      (row) => row.reopenedCount === 0 && row.messages.length <= 1,
    ).length;

    const byDay = new Map<string, { resolved: number; resolutionMinutes: number[] }>();
    for (const row of resolvedRows) {
      if (!row.resolvedAt) continue;
      const key = row.resolvedAt.toISOString().slice(0, 10);
      const bucket = byDay.get(key) ?? { resolved: 0, resolutionMinutes: [] };
      bucket.resolved += 1;
      const minutes = durationMinutes(row.createdAt, row.resolvedAt);
      if (minutes !== null) bucket.resolutionMinutes.push(minutes);
      byDay.set(key, bucket);
    }

    const agentMap = new Map<number, typeof resolvedRows>();
    for (const row of resolvedRows) {
      if (!row.assignedAdminId) continue;
      const bucket = agentMap.get(row.assignedAdminId) ?? [];
      bucket.push(row);
      agentMap.set(row.assignedAdminId, bucket);
    }
    const agentIds = [...agentMap.keys()];
    const agents = agentIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : [];
    const agentNames = new Map(agents.map((agent) => [agent.id, this.userName(agent)]));
    const topAgents = [...agentMap.entries()]
      .map(([adminId, rows]) => {
        const responses = rows
          .map((row) => durationMinutes(row.createdAt, row.firstResponseAt))
          .filter((value): value is number => value !== null);
        const scores = rows
          .map((row) => row.satisfactionScore)
          .filter((value): value is number => value !== null);
        const fcr = rows.filter(
          (row) => row.reopenedCount === 0 && row.messages.length <= 1,
        ).length;
        return {
          adminId: String(adminId),
          name: agentNames.get(adminId) ?? `Admin ${adminId}`,
          ticketsResolved: rows.length,
          avgFirstResponseMinutes: this.average(responses),
          csatPercent: scores.length ? this.average(scores.map((score) => score * 20)) : null,
          csatResponses: scores.length,
          firstContactResolutionPercent: rows.length
            ? Math.round((fcr / rows.length) * 10_000) / 100
            : null,
        };
      })
      .sort((a, b) => b.ticketsResolved - a.ticketsResolved)
      .slice(0, 10);

    const categoryTotal = categoryGroups.reduce((sum, row) => sum + row._count, 0);
    const avgResolutionMinutes = this.average(resolutionMinutes);
    const avgCsatPercent = this.average(csatScores.map((score) => score * 20));

    return {
      period: {
        from: query.from ?? null,
        to: query.to ?? null,
      },
      summary: {
        ...summary,
        ticketsResolved: resolvedRows.length,
        avgResolutionTimeHours:
          avgResolutionMinutes !== null
            ? Math.round((avgResolutionMinutes / 60) * 100) / 100
            : null,
        avgFirstResponseMinutes: this.average(responseMinutes),
        customerSatisfaction: {
          trackingAvailable: csatScores.length > 0,
          scorePercent: avgCsatPercent !== null ? Math.round(avgCsatPercent * 100) / 100 : null,
          responses: csatScores.length,
        },
        firstContactResolution: {
          trackingAvailable: true,
          definition:
            'Resolved without reopening and with at most one public administrator response.',
          percent: resolvedRows.length
            ? Math.round((fcrCount / resolvedRows.length) * 10_000) / 100
            : null,
        },
      },
      dailyResolutions: [...byDay.entries()].map(([dateKey, data]) => {
        const avgDailyResolutionMinutes = this.average(data.resolutionMinutes);

        return {
          date: dateKey,
          resolved: data.resolved,
          avgResolutionTimeHours:
            avgDailyResolutionMinutes !== null
              ? Math.round((avgDailyResolutionMinutes / 60) * 100) / 100
              : null,
        };
      }),
      byCategory: categoryGroups
        .map((row) => ({
          category: row.category,
          count: row._count,
          percent: categoryTotal ? Math.round((row._count / categoryTotal) * 10_000) / 100 : 0,
        }))
        .sort((a, b) => b.count - a.count),
      topAgents,
    };
  }

  private async summary() {
    const resolved24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [active, waiting, escalated, resolved, unreadParticipantMessages] = await Promise.all([
      this.prisma.supportTicket.count({
        where: { status: { in: [...ACTIVE_SUPPORT_STATUSES] } },
      }),
      this.prisma.supportTicket.count({ where: { status: 'waiting' } }),
      this.prisma.supportTicket.count({ where: { status: 'escalated' } }),
      this.prisma.supportTicket.count({
        where: { resolvedAt: { gte: resolved24h } },
      }),
      this.prisma.supportTicketMessage.count({
        where: {
          isInternalNote: false,
          senderRole: { in: [UserRole.Customer, UserRole.Tasker] },
          readAt: null,
        },
      }),
    ]);
    return {
      activeTickets: active,
      waiting,
      escalated,
      resolvedWithin24Hours: resolved,
      unreadParticipantMessages,
    };
  }

  private adminWhere(query: AdminSupportQueryDto): Prisma.SupportTicketWhereInput {
    const view = query.view ?? 'support_tickets';
    const search = query.search?.trim();
    const numericTicketId = search?.match(/^TKT-(\d+)$/i)?.[1];
    const date = this.dateFilter(query);
    const where: Prisma.SupportTicketWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.assignedAdminId ? { assignedAdminId: query.assignedAdminId } : {}),
      ...(date ? { createdAt: date } : {}),
    };

    if (view === 'customer_issues') where.requesterRole = UserRole.Customer;
    if (view === 'tasker_issues') where.requesterRole = UserRole.Tasker;
    if (view === 'escalated') where.status = 'escalated';
    if (view === 'live_chat') where.channel = 'live_chat';

    if (search) {
      where.OR = [
        ...(numericTicketId ? [{ id: Number(numericTicketId) }] : []),
        { subject: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { user: { firstName: { contains: search, mode: 'insensitive' } } },
        { user: { lastName: { contains: search, mode: 'insensitive' } } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
      ];
    }
    return where;
  }

  private dateFilter(query: { from?: string; to?: string }): Prisma.DateTimeFilter | undefined {
    if (!query.from && !query.to) return undefined;
    return {
      ...(query.from ? { gte: new Date(`${query.from}T00:00:00.000Z`) } : {}),
      ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
    };
  }

  private async assertLiveChatAvailable(channel: string): Promise<void> {
    if (channel !== 'live_chat') return;
    const settings = await this.platformSettings.view('general');
    const general = settings.general as { liveChatEnabled?: boolean } | undefined;
    if (general?.liveChatEnabled === false) {
      throw new ConflictException('Live chat support is currently disabled');
    }
  }

  private async assertLinkedContext(user: User, dto: CreateSupportTicketDto): Promise<void> {
    if (dto.bookingId) {
      const owned = await this.prisma.booking.count({
        where: {
          id: dto.bookingId,
          ...(user.role === UserRole.Customer
            ? { customerId: user.id }
            : user.role === UserRole.Tasker
              ? { taskerId: user.id }
              : { id: -1 }),
        },
      });
      if (!owned)
        throw new ForbiddenException('The referenced booking does not belong to this account');
    }
    if (!dto.referenceType && dto.referenceId) {
      throw new BadRequestException('referenceType is required when referenceId is provided');
    }
    if (dto.referenceType && !dto.referenceId) {
      throw new BadRequestException('referenceId is required when referenceType is provided');
    }
    if (dto.referenceType === 'payment_transaction') {
      if (user.role !== UserRole.Customer) {
        throw new ForbiddenException(
          'Payment transaction references are available only to customers',
        );
      }
      const owned = await this.prisma.paymentTransaction.count({
        where: { id: dto.referenceId, customerId: user.id },
      });
      if (!owned)
        throw new ForbiddenException(
          'The referenced payment transaction does not belong to this account',
        );
    }
    if (dto.referenceType === 'tasker_withdrawal') {
      if (user.role !== UserRole.Tasker) {
        throw new ForbiddenException('Withdrawal references are available only to taskers');
      }
      const owned = await this.prisma.taskerWithdrawal.count({
        where: { id: dto.referenceId, taskerId: user.id },
      });
      if (!owned)
        throw new ForbiddenException('The referenced withdrawal does not belong to this account');
    }
  }

  private async supportMessagePage(
    ticketId: number,
    query: ListSupportMessagesQueryDto,
    includeInternalNotes: boolean,
  ) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 50);
    const where: Prisma.SupportTicketMessageWhereInput = {
      ticketId,
      ...(includeInternalNotes ? {} : { isInternalNote: false }),
    };
    if (query.cursor) {
      const cursor = await this.prisma.supportTicketMessage.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      });
      if (!cursor) throw new BadRequestException('Message cursor is invalid for this ticket');
    }
    const [rows, totalItems] = await Promise.all([
      this.prisma.supportTicketMessage.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              profilePicture: true,
              role: true,
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : { skip: offset }),
        take: limit + 1,
      }),
      this.prisma.supportTicketMessage.count({ where }),
    ]);
    const hasMore = rows.length > limit;
    const window = rows.slice(0, limit);
    const nextCursor = hasMore ? (window.at(-1)?.id ?? null) : null;
    return {
      response: {
        ticketId: this.ticketNumber(ticketId),
        page: query.cursor ? null : page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
        nextCursor,
        hasMore,
        items: window.reverse().map((message) => this.serializeMessage(message)),
      },
    };
  }

  private async markSupportMessagesRead(
    ticketId: number,
    audience: 'user' | 'admin',
    readerId: number,
    throughMessageId?: string,
  ) {
    let boundary: { createdAt: Date; id: string } | null = null;
    if (throughMessageId) {
      boundary = await this.prisma.supportTicketMessage.findFirst({
        where: {
          id: throughMessageId,
          ticketId,
          ...(audience === 'user' ? { isInternalNote: false } : {}),
        },
        select: { createdAt: true, id: true },
      });
      if (!boundary) {
        throw new BadRequestException('Read boundary is not a visible message on this ticket');
      }
    }
    return this.prisma.$transaction(async (transaction) => {
      const readAt = new Date();
      const result = await transaction.supportTicketMessage.updateMany({
        where: {
          ticketId,
          isInternalNote: false,
          readAt: null,
          senderRole:
            audience === 'user'
              ? { in: [UserRole.Admin, UserRole.SuperAdmin] }
              : { in: [UserRole.Customer, UserRole.Tasker] },
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
        await this.realtime.enqueueSupportPublic(
          ticketId,
          'support:read',
          {
            ticketId,
            readerId,
            readerAudience: audience,
            updated: result.count,
            throughMessageId: throughMessageId ?? null,
            readAt: readAt.toISOString(),
          },
          transaction,
        );
      }
      return {
        ticketId: this.ticketNumber(ticketId),
        updated: result.count,
        throughMessageId: throughMessageId ?? null,
        readAt: readAt.toISOString(),
      };
    });
  }

  private async unreadSupportMessagesByTicket(
    ticketIds: number[],
    audience: 'user' | 'admin',
  ): Promise<Map<number, number>> {
    if (ticketIds.length === 0) return new Map();
    const rows = await this.prisma.supportTicketMessage.groupBy({
      by: ['ticketId'],
      where: {
        ticketId: { in: ticketIds },
        isInternalNote: false,
        readAt: null,
        senderRole:
          audience === 'user'
            ? { in: [UserRole.Admin, UserRole.SuperAdmin] }
            : { in: [UserRole.Customer, UserRole.Tasker] },
      },
      _count: { id: true },
    });
    return new Map(rows.map((row) => [row.ticketId, row._count.id]));
  }

  private attachmentPublicIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || !('publicId' in item)) return [];
      const publicId = (item as { publicId?: unknown }).publicId;
      return typeof publicId === 'string' ? [publicId] : [];
    });
  }

  private assertSupportMessageRetryMatches(
    message: {
      ticketId: number;
      body: string | null;
      attachments: unknown;
      isInternalNote: boolean;
    },
    ticketId: number,
    dto: SendSupportMessageDto,
    internalNote: boolean,
  ): void {
    const requestedIds = this.attachmentPublicIds(dto.attachments ?? []);
    const storedIds = this.attachmentPublicIds(message.attachments);
    const matches =
      message.ticketId === ticketId &&
      (message.body ?? '') === (dto.body?.trim() ?? '') &&
      message.isInternalNote === internalNote &&
      requestedIds.length === storedIds.length &&
      requestedIds.every((value, index) => value === storedIds[index]);
    if (!matches) {
      throw new ConflictException({
        code: 'CLIENT_MESSAGE_ID_REUSED',
        message: 'clientMessageId was already used with different support message content',
      });
    }
  }

  private assertTicketRetryMatches(
    ticket: {
      channel: string;
      subject: string;
      category: string;
      priority: string;
      description: string | null;
      bookingId: number | null;
      referenceType: string | null;
      referenceId: string | null;
      attachments: unknown;
    },
    dto: CreateSupportTicketDto,
  ): void {
    const requestedIds = this.attachmentPublicIds(dto.attachments ?? []);
    const storedIds = this.attachmentPublicIds(ticket.attachments);
    const matches =
      ticket.channel === (dto.channel ?? 'ticket') &&
      ticket.subject === dto.subject &&
      ticket.category === dto.category &&
      ticket.priority === (dto.priority ?? 'normal') &&
      (ticket.description ?? '') === dto.description &&
      ticket.bookingId === (dto.bookingId ?? null) &&
      ticket.referenceType === (dto.referenceType ?? null) &&
      ticket.referenceId === (dto.referenceId ?? null) &&
      requestedIds.length === storedIds.length &&
      requestedIds.every((value, index) => value === storedIds[index]);
    if (!matches) {
      throw new ConflictException({
        code: 'CLIENT_REQUEST_ID_REUSED',
        message: 'clientRequestId was already used with different support ticket content',
      });
    }
  }

  private async referenceContext(type: string | null, id: string | null, userId: number) {
    if (!type || !id) return null;
    if (type === 'payment_transaction') {
      const row = await this.prisma.paymentTransaction.findFirst({
        where: { id, customerId: userId },
        select: {
          id: true,
          kind: true,
          status: true,
          amount: true,
          currency: true,
          bookingId: true,
          provider: true,
          providerReference: true,
          createdAt: true,
        },
      });
      return row
        ? {
            type,
            id: row.id,
            kind: row.kind,
            status: row.status,
            amount: Number(row.amount),
            currency: row.currency,
            bookingId: row.bookingId ? String(row.bookingId) : null,
            provider: row.provider,
            providerReference: row.providerReference,
            createdAt: row.createdAt.toISOString(),
          }
        : null;
    }
    if (type === 'tasker_withdrawal') {
      const row = await this.prisma.taskerWithdrawal.findFirst({
        where: { id, taskerId: userId },
        select: {
          id: true,
          status: true,
          amount: true,
          currency: true,
          providerReference: true,
          requestedAt: true,
          processedAt: true,
        },
      });
      return row
        ? {
            type,
            id: row.id,
            status: row.status,
            amount: Number(row.amount),
            currency: row.currency,
            providerReference: row.providerReference,
            requestedAt: row.requestedAt.toISOString(),
            processedAt: row.processedAt?.toISOString() ?? null,
          }
        : null;
    }
    return null;
  }

  private async requireOwnedTicket(userId: number, ticketId: number, requesterRole: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId, requesterRole },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return ticket;
  }

  private async lockSupportTicket(
    transaction: Prisma.TransactionClient,
    ticketId: number,
    userId?: number,
    requesterRole?: string,
  ): Promise<SupportTicket> {
    const [ticket] = await transaction.$queryRaw<SupportTicket[]>`
      SELECT * FROM "SupportTickets"
      WHERE "id" = ${ticketId}
      FOR UPDATE
    `;
    if (
      !ticket ||
      (userId !== undefined && ticket.userId !== userId) ||
      (requesterRole !== undefined && ticket.requesterRole !== requesterRole)
    ) {
      throw new NotFoundException('Support ticket not found');
    }
    return ticket;
  }

  private async requireTicket(ticketId: number) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Support ticket not found');
    return ticket;
  }

  private async assertSupportAdmin(adminId: number): Promise<void> {
    const admin = await this.prisma.user.findFirst({
      where: {
        id: adminId,
        deletedAt: null,
        accountStatus: 'active',
        OR: [
          { role: UserRole.SuperAdmin },
          { role: UserRole.Admin, permissions: { has: 'support.manage' } },
        ],
      },
      select: { id: true },
    });
    if (!admin) {
      throw new BadRequestException(
        'Assigned administrator must have active support.manage access',
      );
    }
  }

  private async notifySupportTeam(
    ticketId: number,
    title: string,
    body: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = transaction ?? this.prisma;
    const admins = await client.user.findMany({
      where: {
        deletedAt: null,
        accountStatus: 'active',
        OR: [
          { role: UserRole.SuperAdmin },
          { role: UserRole.Admin, permissions: { has: 'support.manage' } },
        ],
      },
      select: { id: true },
      take: 100,
    });
    if (transaction) {
      for (const admin of admins) {
        await this.notifications.create(
          admin.id,
          {
            category: 'system',
            type: 'support_queue_update',
            title,
            body,
            entityType: 'support_ticket',
            entityId: String(ticketId),
          },
          transaction,
        );
      }
      return;
    }
    await Promise.allSettled(
      admins.map((admin) =>
        this.notifications.create(admin.id, {
          category: 'system',
          type: 'support_queue_update',
          title,
          body,
          entityType: 'support_ticket',
          entityId: String(ticketId),
        }),
      ),
    );
  }

  private assertSupportUser(user: User): void {
    if (!SUPPORT_USER_ROLES.has(user.role)) {
      throw new ForbiddenException(
        'Only customers and taskers can open participant support tickets',
      );
    }
  }

  private assertMessage(body: string | undefined, attachmentCount: number): void {
    if (!body?.trim() && attachmentCount === 0) {
      throw new BadRequestException('A message body or at least one attachment is required');
    }
  }

  private serializeTicket(ticket: {
    id: number;
    requesterRole: string;
    clientRequestId: string | null;
    channel: string;
    subject: string;
    category: string;
    priority: string;
    status: string;
    assignedAdminId: number | null;
    firstResponseAt: Date | null;
    waitingSince: Date | null;
    escalatedAt: Date | null;
    escalationReason: string | null;
    resolvedAt: Date | null;
    resolutionSummary: string | null;
    closedAt: Date | null;
    reopenedCount: number;
    lastMessageAt: Date;
    createdAt: Date;
    updatedAt: Date;
    assignedAdmin?: {
      id: number;
      firstName: string | null;
      lastName: string | null;
      profilePicture?: string | null;
    } | null;
    _count?: { messages: number };
  }) {
    return {
      id: String(ticket.id),
      requesterRole: ticket.requesterRole,
      clientRequestId: ticket.clientRequestId,
      ticketId: this.ticketNumber(ticket.id),
      channel: ticket.channel,
      subject: ticket.subject,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      assignedAgent: ticket.assignedAdmin
        ? {
            id: String(ticket.assignedAdmin.id),
            name: this.userName(ticket.assignedAdmin),
            profilePicture: ticket.assignedAdmin.profilePicture ?? '',
          }
        : null,
      messageCount: ticket._count?.messages ?? null,
      firstResponseAt: ticket.firstResponseAt?.toISOString() ?? null,
      waitingSince: ticket.waitingSince?.toISOString() ?? null,
      escalatedAt: ticket.escalatedAt?.toISOString() ?? null,
      escalationReason: ticket.escalationReason,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      resolutionSummary: ticket.resolutionSummary,
      closedAt: ticket.closedAt?.toISOString() ?? null,
      reopenedCount: ticket.reopenedCount,
      lastMessageAt: ticket.lastMessageAt.toISOString(),
      createdAt: ticket.createdAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    };
  }

  private async enqueueSupportTicketUpdated(
    ticket: {
      id: number;
      status: string;
      priority: string;
      assignedAdminId: number | null;
      channel: string;
      lastMessageAt: Date;
      updatedAt: Date;
    },
    transaction: Prisma.TransactionClient,
    scope: 'public' | 'internal' = 'public',
  ): Promise<void> {
    const payload: Prisma.InputJsonObject = {
      ticketId: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      assignedAdminId: ticket.assignedAdminId,
      channel: ticket.channel,
      lastMessageAt: ticket.lastMessageAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    };
    await (scope === 'internal'
      ? this.realtime.enqueueSupportAdmins(
          ticket.id,
          'support:ticket_updated',
          payload,
          transaction,
        )
      : this.realtime.enqueueSupportPublic(
          ticket.id,
          'support:ticket_updated',
          payload,
          transaction,
        ));
  }

  private supportMessageEvent(message: {
    id: string;
    ticketId: number;
    senderId: number;
    senderRole: string;
    clientMessageId: string | null;
    body: string | null;
    attachments: unknown;
    isInternalNote: boolean;
    readAt: Date | null;
    createdAt: Date;
  }): Prisma.InputJsonObject {
    return {
      id: message.id,
      ticketId: message.ticketId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      clientMessageId: message.clientMessageId,
      body: message.body ?? '',
      attachments: (Array.isArray(message.attachments)
        ? message.attachments
        : []) as Prisma.InputJsonArray,
      internalNote: message.isInternalNote,
      readAt: message.readAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private serializeMessage(message: {
    id: string;
    ticketId: number;
    senderId: number;
    senderRole: string;
    clientMessageId: string | null;
    body: string | null;
    attachments: unknown;
    isInternalNote: boolean;
    readAt: Date | null;
    createdAt: Date;
    sender: {
      id: number;
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
      role: string;
    };
  }) {
    return {
      id: message.id,
      clientMessageId: message.clientMessageId,
      ticketId: this.ticketNumber(message.ticketId),
      sender: {
        id: String(message.sender.id),
        name: this.userName(message.sender),
        role: message.sender.role,
        profilePicture: message.sender.profilePicture ?? '',
      },
      body: message.body,
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
      internalNote: message.isInternalNote,
      readAt: message.readAt?.toISOString() ?? null,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private serializeMessageWithUser(
    message: {
      id: string;
      ticketId: number;
      senderId: number;
      senderRole: string;
      clientMessageId: string | null;
      body: string | null;
      attachments: unknown;
      isInternalNote: boolean;
      readAt: Date | null;
      createdAt: Date;
    },
    user: User,
  ) {
    return this.serializeMessage({
      ...message,
      sender: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePicture: user.profilePicture,
        role: user.role,
      },
    });
  }

  private ticketNumber(id: number): string {
    return `TKT-${String(id).padStart(4, '0')}`;
  }

  private userName(user: { firstName: string | null; lastName: string | null }): string {
    const value = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
    return value || 'Latache user';
  }

  private average(values: number[]): number | null {
    if (values.length === 0) return null;
    return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
  }
}
