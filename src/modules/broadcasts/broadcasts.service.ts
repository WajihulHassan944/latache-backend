import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export type Audience = 'customers' | 'taskers' | 'everyone';
const BATCH = 50;
const PAUSE_MS = 150;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);
  /** In-process guard: one broadcast sends at a time. */
  private sending: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AdminAuditService,
  ) {}

  private audienceWhere(audience: Audience): Prisma.UserWhereInput {
    const roles = audience === 'customers' ? ['customer'] : audience === 'taskers' ? ['tasker'] : ['customer', 'tasker'];
    return { isAdmin: false, deletedAt: null, accountStatus: 'active', roles: { hasSome: roles } };
  }

  audienceCount(audience: Audience): Promise<number> {
    return this.prisma.user.count({ where: this.audienceWhere(audience) });
  }

  async list(query: { page?: number; limit?: number }) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 20);
    const [items, totalItems] = await Promise.all([
      this.prisma.broadcast.findMany({ orderBy: { createdAt: 'desc' }, skip: offset, take: limit }),
      this.prisma.broadcast.count(),
    ]);
    return { page, limit, totalItems, totalPages: Math.ceil(totalItems / limit), items: items.map((b) => this.view(b)) };
  }

  async create(actor: User, dto: { title: string; body: string; audience: Audience }) {
    const row = await this.prisma.broadcast.create({ data: { title: dto.title, body: dto.body, audience: dto.audience, createdById: actor.id } });
    await this.audit.record({ actorId: actor.id, action: 'broadcast_created', entityType: 'broadcast', entityId: row.id, metadata: { audience: dto.audience } });
    return this.view(row);
  }

  async remove(actor: User, id: string) {
    const row = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Announcement not found');
    if (row.status !== 'draft') throw new BadRequestException('Only drafts can be deleted');
    await this.prisma.broadcast.delete({ where: { id } });
    await this.audit.record({ actorId: actor.id, action: 'broadcast_deleted', entityType: 'broadcast', entityId: id });
    return { deleted: true };
  }

  /** Marks the announcement as sending and delivers it in the background; returns immediately. */
  async send(actor: User, id: string) {
    if (this.sending) throw new ConflictException({ code: 'BROADCAST_IN_PROGRESS', message: 'Another announcement is still being sent. Please wait for it to finish.' });
    const row = await this.prisma.broadcast.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Announcement not found');
    if (row.status !== 'draft') throw new BadRequestException('This announcement was already sent');
    const audience = row.audience as Audience;
    const total = await this.audienceCount(audience);
    if (total === 0) throw new BadRequestException('No active users in this audience');

    this.sending = id;
    const updated = await this.prisma.broadcast.update({ where: { id }, data: { status: 'sending', recipientCount: total, sentAt: new Date() } });
    await this.audit.record({ actorId: actor.id, action: 'broadcast_sent', entityType: 'broadcast', entityId: id, metadata: { audience, recipients: total } });
    void this.deliver(id, audience, row.title, row.body).finally(() => {
      this.sending = null;
    });
    return this.view(updated);
  }

  private async deliver(id: string, audience: Audience, title: string, body: string): Promise<void> {
    let cursor = 0;
    let sent = 0;
    let failed = 0;
    try {
      for (;;) {
        const users = await this.prisma.user.findMany({
          where: { ...this.audienceWhere(audience), id: { gt: cursor } },
          select: { id: true, roles: true },
          orderBy: { id: 'asc' },
          take: BATCH,
        });
        if (users.length === 0) break;
        for (const user of users) {
          try {
            // A person who is both customer and Tasker gets it once, in the role the audience targets.
            const audienceRole = audience === 'taskers' ? UserRole.Tasker : audience === 'customers' ? UserRole.Customer : undefined;
            await this.notifications.create(user.id, {
              category: 'system',
              type: 'admin_announcement',
              title,
              body,
              entityType: 'broadcast',
              entityId: id,
              audienceRole,
            });
            sent += 1;
          } catch (error) {
            failed += 1;
            this.logger.warn(`Broadcast ${id}: user ${user.id} failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        cursor = users[users.length - 1]?.id ?? cursor;
        await this.prisma.broadcast.update({ where: { id }, data: { sentCount: sent, failedCount: failed } });
        await sleep(PAUSE_MS);
      }
      await this.prisma.broadcast.update({ where: { id }, data: { status: 'sent', sentCount: sent, failedCount: failed, completedAt: new Date() } });
    } catch (error) {
      this.logger.error(`Broadcast ${id} aborted: ${error instanceof Error ? error.message : String(error)}`);
      await this.prisma.broadcast
        .update({ where: { id }, data: { status: 'failed', sentCount: sent, failedCount: failed, lastError: (error instanceof Error ? error.message : 'unknown').slice(0, 500), completedAt: new Date() } })
        .catch(() => undefined);
    }
  }

  private view(b: { id: string; title: string; body: string; audience: string; status: string; recipientCount: number; sentCount: number; failedCount: number; lastError: string | null; createdAt: Date; sentAt: Date | null; completedAt: Date | null }) {
    return {
      id: b.id,
      title: b.title,
      body: b.body,
      audience: b.audience,
      status: b.status,
      recipientCount: b.recipientCount,
      sentCount: b.sentCount,
      failedCount: b.failedCount,
      lastError: b.lastError,
      createdAt: b.createdAt.toISOString(),
      sentAt: b.sentAt?.toISOString() ?? null,
      completedAt: b.completedAt?.toISOString() ?? null,
    };
  }
}
