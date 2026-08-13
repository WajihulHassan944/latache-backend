import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Prisma, type ObjectStorageDeletionTask } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UploadsService } from '../uploads/uploads.service';
import type { CloudinaryResourceType } from '../uploads/uploads.types';

export interface ManagedAssetReference {
  publicId: string;
  resourceType: CloudinaryResourceType;
}

@Injectable()
export class ObjectStorageDeletionService {
  private readonly logger = new Logger(ObjectStorageDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly config: ConfigService,
  ) {}

  extractManagedAssets(...values: unknown[]): ManagedAssetReference[] {
    const assets = new Map<string, ManagedAssetReference>();
    const visit = (value: unknown, hintedType: CloudinaryResourceType = 'image'): void => {
      if (typeof value === 'string') {
        const parsed = this.parseReference(value, hintedType);
        if (parsed) assets.set(`${parsed.resourceType}:${parsed.publicId}`, parsed);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((entry) => visit(entry, hintedType));
        return;
      }
      if (!value || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      const resourceType = this.normalizeResourceType(
        typeof record.resourceType === 'string'
          ? record.resourceType
          : typeof record.resource_type === 'string'
            ? record.resource_type
            : hintedType,
      );
      const publicId =
        typeof record.publicId === 'string'
          ? record.publicId
          : typeof record.public_id === 'string'
            ? record.public_id
            : null;
      if (publicId) {
        const parsed = this.parseReference(publicId, resourceType);
        if (parsed) assets.set(`${parsed.resourceType}:${parsed.publicId}`, parsed);
      }
      Object.values(record).forEach((entry) => visit(entry, resourceType));
    };
    values.forEach((value) => visit(value));
    return [...assets.values()];
  }

  async enqueue(
    tx: Prisma.TransactionClient,
    assets: readonly ManagedAssetReference[],
    entityType: string,
    entityId: string | number,
    requestedById: number,
  ): Promise<number> {
    if (assets.length === 0) return 0;
    const result = await tx.objectStorageDeletionTask.createMany({
      data: assets.map((asset) => ({
        publicId: asset.publicId,
        resourceType: asset.resourceType,
        entityType,
        entityId: String(entityId),
        requestedById,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async processPending(): Promise<number> {
    const batchSize = this.config.get<number>('objectStorageDeletion.batchSize', 100);
    const lockToken = randomUUID();
    const now = new Date();
    const staleBefore = new Date(
      now.getTime() - this.config.get<number>('objectStorageDeletion.lockTimeoutMs', 5 * 60_000),
    );
    const claimable: Prisma.ObjectStorageDeletionTaskWhereInput = {
      OR: [
        { status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now } },
        { status: 'processing', lockedAt: { lte: staleBefore } },
      ],
    };
    const candidates = await this.prisma.objectStorageDeletionTask.findMany({
      where: claimable,
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });
    if (candidates.length === 0) return 0;
    await this.prisma.objectStorageDeletionTask.updateMany({
      where: {
        id: { in: candidates.map((row) => row.id) },
        ...claimable,
      },
      data: { status: 'processing', lockedAt: now, lockToken },
    });
    const claimed = await this.prisma.objectStorageDeletionTask.findMany({
      where: { lockToken, status: 'processing' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    let completed = 0;
    for (const task of claimed) {
      if (await this.processOne(task)) completed += 1;
    }
    return completed;
  }

  async statusFor(entityType: string, entityId: string | number) {
    const rows = await this.prisma.objectStorageDeletionTask.groupBy({
      by: ['status'],
      where: { entityType, entityId: String(entityId) },
      _count: { _all: true },
    });
    const counts = new Map(rows.map((row) => [row.status, row._count._all]));
    const completed = counts.get('completed') ?? 0;
    const pending =
      (counts.get('pending') ?? 0) + (counts.get('failed') ?? 0) + (counts.get('processing') ?? 0);
    return { completed, pending, total: completed + pending };
  }

  async attemptImmediate(
    entityType: string,
    entityId: string | number,
    queued: number,
  ): Promise<{ completed: number; pending: number; total: number; deferred?: boolean }> {
    try {
      await this.processPending();
      return await this.statusFor(entityType, entityId);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          event: 'object_storage_immediate_cleanup_deferred',
          entityType,
          entityId: String(entityId),
          queued,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        }),
      );
      return { completed: 0, pending: queued, total: queued, deferred: true };
    }
  }

  async backlog(): Promise<{ pending: number; failed: number; oldestPendingAt: string | null }> {
    const [pending, failed, oldest] = await Promise.all([
      this.prisma.objectStorageDeletionTask.count({
        where: { status: { in: ['pending', 'processing'] } },
      }),
      this.prisma.objectStorageDeletionTask.count({ where: { status: 'failed' } }),
      this.prisma.objectStorageDeletionTask.findFirst({
        where: { status: { in: ['pending', 'processing', 'failed'] } },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { pending, failed, oldestPendingAt: oldest?.createdAt.toISOString() ?? null };
  }

  private async processOne(task: ObjectStorageDeletionTask): Promise<boolean> {
    try {
      const result = await this.uploads.purgeManagedAsset(
        task.publicId,
        this.normalizeResourceType(task.resourceType),
      );
      if (!['ok', 'not found'].includes(result.toLowerCase())) {
        throw new Error(`Cloudinary returned deletion result: ${result}`);
      }
      const completed = await this.prisma.objectStorageDeletionTask.updateMany({
        where: { id: task.id, status: 'processing', lockToken: task.lockToken },
        data: {
          status: 'completed',
          attempts: { increment: 1 },
          completedAt: new Date(),
          lockedAt: null,
          lockToken: null,
          lastError: null,
        },
      });
      return completed.count === 1;
    } catch (error) {
      const attempts = task.attempts + 1;
      const baseSeconds = this.config.get<number>('objectStorageDeletion.retryBaseSeconds', 60);
      const delaySeconds = Math.min(baseSeconds * 2 ** Math.min(attempts - 1, 8), 86_400);
      const nextAttemptAt = new Date(Date.now() + delaySeconds * 1_000);
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const failed = await this.prisma.objectStorageDeletionTask.updateMany({
        where: { id: task.id, status: 'processing', lockToken: task.lockToken },
        data: {
          status: 'failed',
          attempts,
          nextAttemptAt,
          lockedAt: null,
          lockToken: null,
          lastError: message,
        },
      });
      if (failed.count === 0) return false;
      this.logger.error(
        JSON.stringify({
          event: 'object_storage_deletion_failed',
          taskId: task.id,
          entityType: task.entityType,
          entityId: task.entityId,
          attempts,
          error: message,
        }),
      );
      return false;
    }
  }

  private parseReference(
    value: string,
    hintedType: CloudinaryResourceType,
  ): ManagedAssetReference | null {
    const trimmed = value.trim();
    const folder = this.config
      .get<string>('cloudinary.folder', 'latache')
      .replace(/^\/+|\/+$/g, '');
    if (trimmed.startsWith(`${folder}/`)) {
      return { publicId: trimmed, resourceType: hintedType };
    }
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com') return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const uploadIndex = segments.indexOf('upload');
    if (uploadIndex < 1) return null;
    const resourceType = this.normalizeResourceType(segments[uploadIndex - 1] ?? hintedType);
    const afterUpload = segments.slice(uploadIndex + 1);
    if (/^v\d+$/.test(afterUpload[0] ?? '')) afterUpload.shift();
    let publicId = afterUpload.join('/');
    if (resourceType !== 'raw') publicId = publicId.replace(/\.[^/.]+$/, '');
    if (!publicId.startsWith(`${folder}/`)) return null;
    return { publicId, resourceType };
  }

  private normalizeResourceType(value: string): CloudinaryResourceType {
    return value === 'video' || value === 'raw' ? value : 'image';
  }
}
