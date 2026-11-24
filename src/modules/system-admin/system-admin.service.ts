import { Injectable } from '@nestjs/common';
import { normalizePagination } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import type { Prisma } from '../../generated/prisma/client';
import { PerformanceJobsService } from '../../infrastructure/jobs/performance-jobs.service';

interface AuditQuery {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  actorId?: number;
  from?: string;
  to?: string;
}

const name = (u?: { firstName: string | null; lastName: string | null; email: string } | null) =>
  u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email : null;

@Injectable()
export class SystemAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: PerformanceJobsService,
  ) {}

  async health() {
    const started = Date.now();
    let database: { ok: boolean; latencyMs: number | null; error?: string };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      database = { ok: false, latencyMs: null, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' };
    }
    const queue = await this.jobs.health().catch(() => null);
    return {
      checkedAt: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
      nodeVersion: process.version,
      database,
      queue,
    };
  }

  async auditLogs(query: AuditQuery) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 40);
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to ? { createdAt: { ...(query.from ? { gte: new Date(query.from) } : {}), ...(query.to ? { lte: new Date(query.to) } : {}) } } : {}),
    };
    const [rows, totalItems, entityTypes] = await Promise.all([
      this.prisma.adminAuditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, email: true } },
          targetUser: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
      }),
      this.prisma.adminAuditLog.count({ where }),
      this.prisma.adminAuditLog.groupBy({ by: ['entityType'], _count: { _all: true }, orderBy: { _count: { entityType: 'desc' } }, take: 30 }),
    ]);
    return {
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
      entityTypes: entityTypes.map((e) => e.entityType),
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        reason: row.reason,
        metadata: row.metadata,
        actor: row.actor ? { id: row.actor.id, name: name(row.actor), email: row.actor.email } : null,
        targetUser: row.targetUser ? { id: row.targetUser.id, name: name(row.targetUser), email: row.targetUser.email } : null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
