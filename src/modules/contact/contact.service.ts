import { BadRequestException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { AdminAlertsService } from '../admin-alerts/admin-alerts.service';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { TurnstileService } from '../auth/services/turnstile.service';
import { MailService } from '../mail/mail.service';
import { enquiryReceivedEmail, enquiryReplyEmail } from './contact-email.template';
import type { EnquiriesQueryDto, SubmitEnquiryDto, UpdateEnquiryDto } from './contact.dto';

const SLA_HOURS = 24;
const adminName = (u?: { firstName: string | null; lastName: string | null } | null) => (u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'Admin' : null);

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly turnstile: TurnstileService,
    private readonly mail: MailService,
    private readonly audit: AdminAuditService,
    private readonly alerts: AdminAlertsService,
  ) {}

  // ───────── public ─────────

  async submit(dto: SubmitEnquiryDto, meta: { ip?: string; locale: string }) {
    // Honeypot: bots fill the hidden field; answer like a success so they learn nothing.
    if (dto.website?.trim()) return { reference: 'LC-Q-000000' };
    if (!dto.consent) throw new BadRequestException({ code: 'CONSENT_REQUIRED', message: 'Please accept the privacy notice to send your message.' });
    await this.turnstile.verify(dto.captchaToken, meta.ip, 'contact');

    const reference = `LC-Q-${randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
    const enquiry = await this.prisma.contactEnquiry.create({
      data: {
        reference,
        fullName: dto.fullName,
        email: dto.email,
        phone: dto.phone || null,
        topic: dto.topic,
        locale: meta.locale,
        messages: { create: { direction: 'inbound', body: dto.message } },
      },
    });

    await this.alerts.raise({
      type: 'contact.new',
      title: `New enquiry from ${dto.fullName}`,
      body: `${dto.topic} · ${dto.message.slice(0, 140)}`,
      link: `/admin/contact?open=${enquiry.id}`,
      entityType: 'contact_enquiry',
      entityId: enquiry.id,
      severity: dto.topic === 'privacy' ? 'warning' : 'info',
    });

    try {
      const email = enquiryReceivedEmail({ locale: meta.locale, name: dto.fullName, reference });
      await this.mail.sendRenderedEmail({ to: dto.email, ...email });
    } catch (error) {
      // The enquiry is saved; a failed acknowledgement must not lose the message.
      this.logger.warn(`Enquiry ${reference}: acknowledgement email failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { reference };
  }

  // ───────── admin ─────────

  async list(admin: User, query: EnquiriesQueryDto) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const search = query.search?.trim();
    const base: Prisma.ContactEnquiryWhereInput = {
      ...(query.topic ? { topic: query.topic } : {}),
      ...(query.assignee === 'me' ? { assignedAdminId: admin.id } : query.assignee === 'unassigned' ? { assignedAdminId: null } : query.assignee && /^\d+$/.test(query.assignee) ? { assignedAdminId: Number(query.assignee) } : {}),
      ...(search
        ? { OR: [{ fullName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }, { reference: { contains: search, mode: 'insensitive' } }, { messages: { some: { body: { contains: search, mode: 'insensitive' } } } }] }
        : {}),
    };
    // Spam stays out of the default view.
    const where: Prisma.ContactEnquiryWhereInput = { ...base, ...(query.status ? { status: query.status } : { status: { not: 'spam' } }) };
    const [rows, totalItems, byStatus] = await Promise.all([
      this.prisma.contactEnquiry.findMany({
        where,
        orderBy: { lastActivityAt: 'desc' },
        skip: offset,
        take: limit,
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
      this.prisma.contactEnquiry.count({ where }),
      this.prisma.contactEnquiry.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    ]);
    const admins = await this.adminNames(rows.map((r) => r.assignedAdminId));
    const now = Date.now();
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      slaHours: SLA_HOURS,
      statusCounts: Object.fromEntries(['new', 'open', 'waiting', 'resolved', 'spam'].map((s) => [s, byStatus.find((r) => r.status === s)?._count._all ?? 0])),
      items: rows.map((r) => {
        const last = r.messages[0];
        const awaitingReply = (r.status === 'new' || r.status === 'open') && last?.direction !== 'outbound';
        return {
          id: r.id,
          reference: r.reference,
          fullName: r.fullName,
          email: r.email,
          topic: r.topic,
          status: r.status,
          assignedAdminId: r.assignedAdminId,
          assignedAdminName: r.assignedAdminId ? (admins.get(r.assignedAdminId) ?? null) : null,
          snippet: last ? last.body.slice(0, 140) : '',
          lastActivityAt: r.lastActivityAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
          awaitingReply,
          waitingMinutes: awaitingReply ? Math.floor((now - r.lastInboundAt.getTime()) / 60_000) : null,
          slaBreached: awaitingReply && now - r.lastInboundAt.getTime() > SLA_HOURS * 3_600_000,
        };
      }),
    };
  }

  async get(id: string) {
    const row = await this.prisma.contactEnquiry.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!row) throw new NotFoundException('Enquiry not found');
    const names = await this.adminNames([row.assignedAdminId, ...row.messages.map((m) => m.authorId)]);
    return {
      id: row.id,
      reference: row.reference,
      fullName: row.fullName,
      email: row.email,
      phone: row.phone,
      topic: row.topic,
      status: row.status,
      locale: row.locale,
      assignedAdminId: row.assignedAdminId,
      assignedAdminName: row.assignedAdminId ? (names.get(row.assignedAdminId) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
      firstResponseAt: row.firstResponseAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      messages: row.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        author: m.authorId ? (names.get(m.authorId) ?? 'Admin') : m.direction === 'inbound' ? row.fullName : null,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async update(actor: User, id: string, dto: UpdateEnquiryDto) {
    const current = await this.prisma.contactEnquiry.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Enquiry not found');
    if (dto.assignedAdminId) {
      const target = await this.prisma.user.findUnique({ where: { id: dto.assignedAdminId }, select: { id: true } });
      if (!target) throw new BadRequestException('That admin does not exist');
    }
    const status = dto.status ?? current.status;
    await this.prisma.contactEnquiry.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.assignedAdminId !== undefined ? { assignedAdminId: dto.assignedAdminId } : {}),
        resolvedAt: status === 'resolved' ? (current.resolvedAt ?? new Date()) : null,
        lastActivityAt: new Date(),
      },
    });
    await this.audit.record({ actorId: actor.id, action: 'contact_enquiry_updated', entityType: 'contact_enquiry', entityId: id, metadata: { status: dto.status, assignedAdminId: dto.assignedAdminId } });
    return this.get(id);
  }

  async reply(actor: User, id: string, body: string) {
    const enquiry = await this.prisma.contactEnquiry.findUnique({ where: { id } });
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    if (enquiry.status === 'spam') throw new BadRequestException('This enquiry is marked as spam');
    // Send first: a reply that never left must not appear in the thread as sent.
    try {
      const email = enquiryReplyEmail({ locale: enquiry.locale, name: enquiry.fullName, reference: enquiry.reference, body });
      await this.mail.sendRenderedEmail({ to: enquiry.email, ...email });
    } catch (error) {
      this.logger.error(`Enquiry ${enquiry.reference}: reply email failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException({ code: 'EMAIL_FAILED', message: 'The email could not be sent. Nothing was saved - please try again.' });
    }
    await this.prisma.$transaction([
      this.prisma.contactMessage.create({ data: { enquiryId: id, direction: 'outbound', body, authorId: actor.id } }),
      this.prisma.contactEnquiry.update({
        where: { id },
        data: { status: 'waiting', firstResponseAt: enquiry.firstResponseAt ?? new Date(), lastActivityAt: new Date(), assignedAdminId: enquiry.assignedAdminId ?? actor.id },
      }),
    ]);
    await this.audit.record({ actorId: actor.id, action: 'contact_enquiry_replied', entityType: 'contact_enquiry', entityId: id });
    return this.get(id);
  }

  async note(actor: User, id: string, body: string) {
    const exists = await this.prisma.contactEnquiry.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Enquiry not found');
    await this.prisma.contactMessage.create({ data: { enquiryId: id, direction: 'note', body, authorId: actor.id } });
    return this.get(id);
  }

  /** Admins an enquiry can be assigned to. */
  async assignees() {
    const rows = await this.prisma.user.findMany({
      where: { isAdmin: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: 'asc' },
      take: 200,
    });
    return rows.map((u) => ({ id: u.id, name: adminName(u) ?? 'Admin' }));
  }

  private async adminNames(ids: Array<number | null | undefined>) {
    const unique = [...new Set(ids.filter((v): v is number => typeof v === 'number'))];
    if (!unique.length) return new Map<number, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, firstName: true, lastName: true } });
    return new Map(users.map((u) => [u.id, adminName(u) ?? 'Admin']));
  }
}
