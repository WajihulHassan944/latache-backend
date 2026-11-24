import { Injectable, Logger } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface RaiseAlertInput {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  severity?: AlertSeverity;
  entityType?: string | null;
  entityId?: string | number | null;
}

@Injectable()
export class AdminAlertsService {
  private readonly logger = new Logger(AdminAlertsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fire-and-forget: raising an alert must never break the action that caused
   * it (a contact submission, an application, ...), so failures are only logged.
   */
  async raise(input: RaiseAlertInput): Promise<void> {
    try {
      await this.prisma.adminAlert.create({
        data: {
          type: input.type,
          severity: input.severity ?? 'info',
          title: input.title.slice(0, 200),
          body: input.body?.slice(0, 500) ?? null,
          link: input.link ?? null,
          entityType: input.entityType ?? null,
          entityId: input.entityId === undefined || input.entityId === null ? null : String(input.entityId),
        },
      });
    } catch (error) {
      this.logger.warn(`Could not raise admin alert "${input.type}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async list(adminId: number, query: { page?: number; limit?: number; unread?: boolean; type?: string; severity?: string }) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 30);
    const where = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.unread ? { reads: { none: { userId: adminId } } } : {}),
    };
    const [rows, totalItems, unread] = await Promise.all([
      this.prisma.adminAlert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: { reads: { where: { userId: adminId }, select: { readAt: true } } },
      }),
      this.prisma.adminAlert.count({ where }),
      this.unreadCount(adminId),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      unread,
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        severity: row.severity,
        title: row.title,
        body: row.body,
        link: row.link,
        createdAt: row.createdAt.toISOString(),
        read: row.reads.length > 0,
      })),
    };
  }

  unreadCount(adminId: number): Promise<number> {
    return this.prisma.adminAlert.count({ where: { reads: { none: { userId: adminId } } } });
  }

  async markRead(adminId: number, id: string) {
    await this.prisma.adminAlertRead.upsert({
      where: { alertId_userId: { alertId: id, userId: adminId } },
      create: { alertId: id, userId: adminId },
      update: {},
    });
    return { unread: await this.unreadCount(adminId) };
  }

  async markAllRead(adminId: number) {
    const unread = await this.prisma.adminAlert.findMany({
      where: { reads: { none: { userId: adminId } } },
      select: { id: true },
      take: 1000,
    });
    if (unread.length) {
      await this.prisma.adminAlertRead.createMany({
        data: unread.map((a) => ({ alertId: a.id, userId: adminId })),
        skipDuplicates: true,
      });
    }
    return { unread: await this.unreadCount(adminId) };
  }
}
