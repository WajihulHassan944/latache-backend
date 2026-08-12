import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { User } from '../../generated/prisma/client';
import { Prisma } from '../../generated/prisma/client';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PlatformSettingsService } from '../platform-settings/platform-settings.service';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import type {
  AdminSendSupportMessageDto,
  AdminSupportActionDto,
  AdminSupportQueryDto,
  CreateSupportTicketDto,
  ListOwnSupportTicketsQueryDto,
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
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
    private readonly platformSettings: PlatformSettingsService,
    private readonly realtime: RealtimeOutboxService,
  ) {}

  async create(user: User, dto: CreateSupportTicketDto) {
    this.assertSupportUser(user);
    await this.assertLiveChatAvailable(dto.channel ?? 'ticket');
    await this.assertLinkedContext(user, dto);
    this.assertAttachmentOwnership(user, dto.attachments ?? []);

    const now = new Date();
    const ticket = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.supportTicket.create({
        data: {
          userId: user.id,
          channel: dto.channel ?? 'ticket',
          subject: dto.subject,
          category: dto.category,
          priority: dto.priority ?? 'normal',
          status: 'open',
          description: dto.description,
          attachments: dto.attachments?.length
            ? (dto.attachments as unknown as Prisma.InputJsonValue)
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
          body: dto.description,
          attachments: dto.attachments?.length
            ? (dto.attachments as unknown as Prisma.InputJsonValue)
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
      await this.realtime.enqueueSupportPublic(
        created.id,
        'support:ticket_updated',
        {
          ticketId: created.id,
          status: created.status,
          channel: created.channel,
          updatedAt: created.updatedAt.toISOString(),
        },
        transaction,
      );
      return created;
    });

    await this.notifySupportTeam(
      ticket.id,
      `New ${ticket.channel === 'live_chat' ? 'live chat' : 'support ticket'} from ${this.userName(user)}`,
      dto.subject,
    );

    return this.detailForUser(user.id, ticket.id);
  }

  async listOwn(user: User, query: ListOwnSupportTicketsQueryDto) {
    this.assertSupportUser(user);
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where: Prisma.SupportTicketWhereInput = {
      userId: user.id,
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
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => this.serializeTicket(row)),
    };
  }

  async detailForUser(userId: number, ticketId: number) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
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
      reference: await this.referenceContext(ticket.referenceType, ticket.referenceId, userId),
      feedback: ticket.feedbackAt
        ? {
            score: ticket.satisfactionScore,
            comment: ticket.feedbackComment,
            submittedAt: ticket.feedbackAt.toISOString(),
          }
        : null,
    };
  }

  async messagesOwn(user: User, ticketId: number) {
    this.assertSupportUser(user);
    await this.requireOwnedTicket(user.id, ticketId);
    await this.prisma.$transaction(async (transaction) => {
      const readAt = new Date();
      const result = await transaction.supportTicketMessage.updateMany({
        where: {
          ticketId,
          senderId: { not: user.id },
          isInternalNote: false,
          readAt: null,
        },
        data: { readAt },
      });
      if (result.count > 0) {
        await this.realtime.enqueueSupportPublic(
          ticketId,
          'support:read',
          { ticketId, readerId: user.id, updated: result.count, readAt: readAt.toISOString() },
          transaction,
        );
      }
    });
    const messages = await this.prisma.supportTicketMessage.findMany({
      where: { ticketId, isInternalNote: false },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true, profilePicture: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return {
      ticketId: this.ticketNumber(ticketId),
      items: messages.map((message) => this.serializeMessage(message)),
    };
  }

  async sendOwn(user: User, ticketId: number, dto: SendSupportMessageDto) {
    this.assertSupportUser(user);
    this.assertMessage(dto.body, dto.attachments?.length ?? 0);
    this.assertAttachmentOwnership(user, dto.attachments ?? []);
    const ticket = await this.requireOwnedTicket(user.id, ticketId);
    if (ticket.status === 'closed' || ticket.status === 'resolved') {
      throw new ConflictException('Reopen the ticket before sending another message');
    }
    const created = await this.prisma.$transaction(async (transaction) => {
      const message = await transaction.supportTicketMessage.create({
        data: {
          ticketId,
          senderId: user.id,
          senderRole: user.role,
          body: dto.body?.trim() || null,
          attachments: dto.attachments?.length
            ? (dto.attachments as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
        },
      });
      const updatedTicket = await transaction.supportTicket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: new Date(),
          ...(ticket.status === 'waiting'
            ? { status: ticket.assignedAdminId ? 'in_progress' : 'open', waitingSince: null }
            : {}),
        },
      });
      await this.realtime.enqueueSupportPublic(
        ticketId,
        'support:message',
        this.supportMessageEvent(message),
        transaction,
      );
      if (updatedTicket.status !== ticket.status) {
        await this.realtime.enqueueSupportPublic(
          ticketId,
          'support:ticket_updated',
          {
            ticketId,
            status: updatedTicket.status,
            updatedAt: updatedTicket.updatedAt.toISOString(),
          },
          transaction,
        );
      }
      return message;
    });

    if (ticket.assignedAdminId) {
      await this.notifications.create(ticket.assignedAdminId, {
        category: 'system',
        type: 'support_user_reply',
        title: `${this.ticketNumber(ticketId)} has a new reply`,
        body: dto.body?.trim().slice(0, 220) || 'The user sent a support attachment.',
        entityType: 'support_ticket',
        entityId: String(ticketId),
      });
    } else {
      await this.notifySupportTeam(
        ticketId,
        `${this.ticketNumber(ticketId)} has a new reply`,
        dto.body?.trim().slice(0, 220) || 'The user sent a support attachment.',
      );
    }
    return this.serializeMessage({
      ...created,
      sender: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePicture: user.profilePicture,
        role: user.role,
      },
    });
  }

  async userAction(user: User, ticketId: number, dto: SupportTicketUserActionDto) {
    this.assertSupportUser(user);
    const ticket = await this.requireOwnedTicket(user.id, ticketId);
    if (dto.action === 'close') {
      if (ticket.status === 'closed') return this.detailForUser(user.id, ticketId);
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'closed', closedAt: new Date() },
      });
      await this.emitSupportTicketUpdated(ticketId);
      return this.detailForUser(user.id, ticketId);
    }
    if (!['resolved', 'closed'].includes(ticket.status)) {
      throw new ConflictException('Only resolved or closed tickets can be reopened');
    }
    await this.prisma.supportTicket.update({
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
    );
    await this.emitSupportTicketUpdated(ticketId);
    return this.detailForUser(user.id, ticketId);
  }

  async feedback(user: User, ticketId: number, dto: SupportFeedbackDto) {
    this.assertSupportUser(user);
    const ticket = await this.requireOwnedTicket(user.id, ticketId);
    if (!['resolved', 'closed'].includes(ticket.status)) {
      throw new ConflictException(
        'Feedback is available only after the support ticket is resolved',
      );
    }
    if (ticket.feedbackAt) {
      throw new ConflictException('Feedback has already been submitted for this ticket');
    }
    await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        satisfactionScore: dto.score,
        feedbackComment: dto.comment ?? null,
        feedbackAt: new Date(),
      },
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
          orderBy: { createdAt: 'asc' },
          take: 500,
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
        role: ticket.user.role,
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
      messages: ticket.messages.map((message) => this.serializeMessage(message)),
      feedback: ticket.feedbackAt
        ? {
            score: ticket.satisfactionScore,
            comment: ticket.feedbackComment,
            submittedAt: ticket.feedbackAt.toISOString(),
          }
        : null,
    };
  }

  async adminMessages(ticketId: number) {
    await this.requireTicket(ticketId);
    await this.prisma.$transaction(async (transaction) => {
      const readAt = new Date();
      const result = await transaction.supportTicketMessage.updateMany({
        where: {
          ticketId,
          senderRole: { in: [UserRole.Customer, UserRole.Tasker] },
          readAt: null,
        },
        data: { readAt },
      });
      if (result.count > 0) {
        await this.realtime.enqueueSupportPublic(
          ticketId,
          'support:read',
          { ticketId, readerRole: 'support', updated: result.count, readAt: readAt.toISOString() },
          transaction,
        );
      }
    });
    const rows = await this.prisma.supportTicketMessage.findMany({
      where: { ticketId },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true, profilePicture: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return {
      ticketId: this.ticketNumber(ticketId),
      items: rows.map((row) => this.serializeMessage(row)),
    };
  }

  async adminSend(actor: User, ticketId: number, dto: AdminSendSupportMessageDto) {
    this.assertMessage(dto.body, dto.attachments?.length ?? 0);
    this.assertAttachmentOwnership(actor, dto.attachments ?? []);
    const ticket = await this.requireTicket(ticketId);
    if (ticket.status === 'closed') {
      throw new ConflictException('Closed tickets must be reopened before adding a message');
    }
    const internalNote = Boolean(dto.internalNote);
    const now = new Date();
    const message = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.supportTicketMessage.create({
        data: {
          ticketId,
          senderId: actor.id,
          senderRole: actor.role,
          body: dto.body?.trim() || null,
          attachments: dto.attachments?.length
            ? (dto.attachments as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          isInternalNote: internalNote,
        },
      });
      await transaction.supportTicket.update({
        where: { id: ticketId },
        data: {
          lastMessageAt: now,
          ...(!internalNote && !ticket.firstResponseAt ? { firstResponseAt: now } : {}),
          ...(!internalNote && ['open', 'waiting'].includes(ticket.status)
            ? { status: 'in_progress', waitingSince: null }
            : {}),
          ...(!internalNote && !ticket.assignedAdminId ? { assignedAdminId: actor.id } : {}),
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
      await this.audit.record(
        {
          actorId: actor.id,
          targetUserId: ticket.userId,
          action: internalNote ? 'support_internal_note_added' : 'support_reply_sent',
          entityType: 'support_ticket',
          entityId: ticketId,
          metadata: { channel: ticket.channel },
        },
        transaction,
      );
      return created;
    });

    if (!internalNote) {
      await this.notifications.create(ticket.userId, {
        category: 'system',
        type: 'support_agent_reply',
        title: `${this.ticketNumber(ticketId)} has a new support reply`,
        body: dto.body?.trim().slice(0, 220) || 'Support sent an attachment.',
        entityType: 'support_ticket',
        entityId: String(ticketId),
      });
    }
    return this.serializeMessage({
      ...message,
      sender: {
        id: actor.id,
        firstName: actor.firstName,
        lastName: actor.lastName,
        profilePicture: actor.profilePicture,
        role: actor.role,
      },
    });
  }

  async adminAction(actor: User, ticketId: number, dto: AdminSupportActionDto) {
    const ticket = await this.requireTicket(ticketId);
    const now = new Date();

    if (dto.action === 'assign') {
      const targetId = dto.assignedAdminId ?? actor.id;
      await this.assertSupportAdmin(targetId);
      await this.prisma.$transaction(async (transaction) => {
        await transaction.supportTicket.update({
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
      });
      if (targetId !== actor.id) {
        await this.notifications.create(targetId, {
          category: 'system',
          type: 'support_ticket_assigned',
          title: `${this.ticketNumber(ticketId)} assigned to you`,
          body: ticket.subject,
          entityType: 'support_ticket',
          entityId: String(ticketId),
        });
      }
      await this.emitSupportTicketUpdated(ticketId);
      return this.adminDetail(ticketId);
    }

    if (dto.action === 'unassign') {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.supportTicket.update({
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
      });
      await this.emitSupportTicketUpdated(ticketId);
      return this.adminDetail(ticketId);
    }

    if (dto.action === 'start') {
      if (['resolved', 'closed'].includes(ticket.status)) {
        throw new ConflictException('Resolved/closed tickets must be reopened before work resumes');
      }
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: 'in_progress',
          waitingSince: null,
          assignedAdminId: ticket.assignedAdminId ?? actor.id,
        },
      });
      await this.emitSupportTicketUpdated(ticketId);
      return this.adminDetail(ticketId);
    }

    if (dto.action === 'wait') {
      if (['resolved', 'closed'].includes(ticket.status)) {
        throw new ConflictException('Resolved/closed tickets cannot enter waiting state');
      }
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: 'waiting',
          waitingSince: now,
          assignedAdminId: ticket.assignedAdminId ?? actor.id,
        },
      });
      await this.emitSupportTicketUpdated(ticketId);
      return this.adminDetail(ticketId);
    }

    if (dto.action === 'set_priority') {
      if (!dto.priority) throw new BadRequestException('priority is required for set_priority');
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { priority: dto.priority },
      });
      await this.audit.record({
        actorId: actor.id,
        targetUserId: ticket.userId,
        action: 'support_ticket_priority_changed',
        entityType: 'support_ticket',
        entityId: ticketId,
        metadata: { from: ticket.priority, to: dto.priority },
      });
      await this.emitSupportTicketUpdated(ticketId);
      return this.adminDetail(ticketId);
    }

    if (dto.action === 'escalate') {
      if (!dto.reason?.trim())
        throw new BadRequestException('reason is required to escalate a ticket');
      if (['resolved', 'closed'].includes(ticket.status)) {
        throw new ConflictException('Resolved/closed tickets cannot be escalated');
      }
      await this.prisma.$transaction(async (transaction) => {
        await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            status: 'escalated',
            priority: ticket.priority === 'urgent' ? ticket.priority : 'urgent',
            escalatedAt: now,
            escalationReason: dto.reason,
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
            reason: dto.reason,
          },
          transaction,
        );
      });
      await this.notifications.create(ticket.userId, {
        category: 'system',
        type: 'support_ticket_escalated',
        title: `${this.ticketNumber(ticketId)} was escalated`,
        body: 'Your support request has been escalated for additional review.',
        entityType: 'support_ticket',
        entityId: String(ticketId),
      });
      await this.emitSupportTicketUpdated(ticketId);
      return this.adminDetail(ticketId);
    }

    if (dto.action === 'resolve') {
      if (!dto.resolutionSummary?.trim()) {
        throw new BadRequestException('resolutionSummary is required to resolve a ticket');
      }
      await this.prisma.$transaction(async (transaction) => {
        await transaction.supportTicket.update({
          where: { id: ticketId },
          data: {
            status: 'resolved',
            resolvedAt: now,
            resolutionSummary: dto.resolutionSummary,
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
            reason: dto.resolutionSummary,
          },
          transaction,
        );
      });
      await this.notifications.create(ticket.userId, {
        category: 'system',
        type: 'support_ticket_resolved',
        title: `${this.ticketNumber(ticketId)} was resolved`,
        body: dto.resolutionSummary.slice(0, 220),
        entityType: 'support_ticket',
        entityId: String(ticketId),
      });
      await this.emitSupportTicketUpdated(ticketId);
      return this.adminDetail(ticketId);
    }

    if (dto.action === 'close') {
      if (ticket.status !== 'resolved') {
        throw new ConflictException('Only resolved tickets can be closed by an administrator');
      }
      await this.prisma.supportTicket.update({
        where: { id: ticketId },
        data: { status: 'closed', closedAt: now },
      });
      await this.audit.record({
        actorId: actor.id,
        targetUserId: ticket.userId,
        action: 'support_ticket_closed',
        entityType: 'support_ticket',
        entityId: ticketId,
      });
      await this.emitSupportTicketUpdated(ticketId);
      return this.adminDetail(ticketId);
    }

    if (!['resolved', 'closed'].includes(ticket.status)) {
      throw new ConflictException('Only resolved or closed tickets can be reopened');
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.supportTicket.update({
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
    });
    await this.emitSupportTicketUpdated(ticketId);
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
    return {
      view: query.view ?? 'support_tickets',
      summary,
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      items: rows.map((row) => ({
        ...this.serializeTicket(row),
        user: {
          id: String(row.user.id),
          name: this.userName(row.user),
          role: row.user.role,
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
    const [active, waiting, escalated, resolved] = await Promise.all([
      this.prisma.supportTicket.count({
        where: { status: { in: [...ACTIVE_SUPPORT_STATUSES] } },
      }),
      this.prisma.supportTicket.count({ where: { status: 'waiting' } }),
      this.prisma.supportTicket.count({ where: { status: 'escalated' } }),
      this.prisma.supportTicket.count({
        where: { resolvedAt: { gte: resolved24h } },
      }),
    ]);
    return {
      activeTickets: active,
      waiting,
      escalated,
      resolvedWithin24Hours: resolved,
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

    if (view === 'customer_issues') where.user = { role: UserRole.Customer };
    if (view === 'tasker_issues') where.user = { role: UserRole.Tasker };
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
          OR: [{ customerId: user.id }, { taskerId: user.id }],
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

  private assertAttachmentOwnership(
    user: User,
    attachments: Array<{ publicId: string; secureUrl: string }>,
  ): void {
    if (attachments.length === 0) return;
    const baseFolder = this.config
      .get<string>('cloudinary.folder', 'latache')
      .replace(/^\/+|\/+$/g, '');
    const expectedPrefix = `${baseFolder}/support-attachments/${user.role}/${user.id}/`;
    for (const attachment of attachments) {
      if (!attachment.publicId.startsWith(expectedPrefix)) {
        throw new ForbiddenException(
          'Support attachments must be uploaded by the current account using the support-attachments Cloudinary folder',
        );
      }
      let parsed: URL;
      try {
        parsed = new URL(attachment.secureUrl);
      } catch {
        throw new BadRequestException('Invalid support attachment URL');
      }
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'res.cloudinary.com') {
        throw new ForbiddenException('Support attachments must use secure Cloudinary URLs');
      }
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

  private async requireOwnedTicket(userId: number, ticketId: number) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
    });
    if (!ticket) throw new NotFoundException('Support ticket not found');
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

  private async notifySupportTeam(ticketId: number, title: string, body: string): Promise<void> {
    const admins = await this.prisma.user.findMany({
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

  private async emitSupportTicketUpdated(ticketId: number): Promise<void> {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        status: true,
        priority: true,
        assignedAdminId: true,
        channel: true,
        lastMessageAt: true,
        updatedAt: true,
      },
    });
    if (!ticket) return;
    const payload: Prisma.InputJsonObject = {
      ticketId: ticket.id,
      status: ticket.status,
      priority: ticket.priority,
      assignedAdminId: ticket.assignedAdminId,
      channel: ticket.channel,
      lastMessageAt: ticket.lastMessageAt.toISOString(),
      updatedAt: ticket.updatedAt.toISOString(),
    };
    await Promise.all([
      this.realtime.enqueueSupportPublic(ticketId, 'support:ticket_updated', payload),
      this.realtime.enqueueSupportAdmins(ticketId, 'support:ticket_updated', payload),
    ]);
  }

  private supportMessageEvent(message: {
    id: string;
    ticketId: number;
    senderId: number;
    senderRole: string;
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
