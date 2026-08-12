import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import type { RealtimeEnvelope } from './realtime.types';
import { RealtimeCallsService } from './realtime-calls.service';
import { RealtimeGateway } from './realtime.gateway';

interface ClaimedOutboxEvent {
  id: string;
  room: string;
  eventName: string;
  payload: unknown;
  attempts: number;
  createdAt: Date;
}

@Injectable()
export class RealtimeDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RealtimeDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private sessionTimer?: NodeJS.Timeout;
  private callTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly gateway: RealtimeGateway,
    private readonly calls: RealtimeCallsService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('app.serviceMode', 'all') === 'worker') return;

    // BullMQ owns periodic call maintenance when enabled. The interval remains
    // only as a Redis-free development fallback.
    if (!this.config.get<boolean>('jobs.enabled', false)) {
      const callSweepMs = this.config.get<number>('chat.callSweepMs', 5_000);
      this.callTimer = setInterval(() => void this.runCallSweep(), callSweepMs);
      this.callTimer.unref();
      this.cleanupTimer = setInterval(
        () => void this.cleanupPublished().catch((error) => this.logCleanupFailure(error)),
        this.config.get<number>('jobs.outboxCleanupIntervalMs', 3_600_000),
      );
      this.cleanupTimer.unref();
    }

    if (!this.config.get<boolean>('realtime.enabled', true)) return;
    const pollMs = this.config.get<number>('realtime.outboxPollMs', 500);
    const sessionSweepMs = this.config.get<number>('realtime.sessionSweepMs', 30_000);
    this.timer = setInterval(() => void this.flush(), pollMs);
    this.sessionTimer = setInterval(() => void this.gateway.sweepInvalidSessions(), sessionSweepMs);
    this.timer.unref();
    this.sessionTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.sessionTimer) clearInterval(this.sessionTimer);
    if (this.callTimer) clearInterval(this.callTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  private async runCallSweep(): Promise<void> {
    try {
      await this.calls.expireStaleCalls();
    } catch (error) {
      this.logger.error(
        'Conversation call sweep failed',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    }
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const events = await this.claim();
      for (const event of events) {
        try {
          const envelope: RealtimeEnvelope = {
            eventId: event.id,
            occurredAt: event.createdAt.toISOString(),
            data: event.payload,
          };
          this.gateway.emitEnvelope(event.room, event.eventName, envelope);
          await this.prisma.realtimeOutboxEvent.update({
            where: { id: event.id },
            data: { publishedAt: new Date(), lockedAt: null, lockToken: null, lastError: null },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Realtime event ${event.id} failed: ${message}`);
          await this.prisma.realtimeOutboxEvent.update({
            where: { id: event.id },
            data: { lockedAt: null, lockToken: null, lastError: message.slice(0, 1000) },
          });
        }
      }
    } catch (error) {
      this.logger.error(
        'Realtime outbox dispatch failed',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
    } finally {
      this.flushing = false;
    }
  }

  private async claim(): Promise<ClaimedOutboxEvent[]> {
    const token = randomUUID().replaceAll('-', '');
    const batchSize = this.config.get<number>('realtime.outboxBatchSize', 100);
    const staleSeconds = Math.max(
      10,
      Math.floor(this.config.get<number>('realtime.outboxLockMs', 30_000) / 1000),
    );
    return this.prisma.$queryRaw<ClaimedOutboxEvent[]>`
      WITH candidates AS (
        SELECT "id"
        FROM "RealtimeOutboxEvents"
        WHERE "publishedAt" IS NULL
          AND ("lockedAt" IS NULL OR "lockedAt" < NOW() - (${staleSeconds} * INTERVAL '1 second'))
        ORDER BY "createdAt" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE "RealtimeOutboxEvents" event
      SET "lockedAt" = NOW(),
          "lockToken" = ${token},
          "attempts" = event."attempts" + 1
      FROM candidates
      WHERE event."id" = candidates."id"
      RETURNING event."id", event."room", event."eventName", event."payload", event."attempts", event."createdAt"
    `;
  }

  async expireStaleCalls(): Promise<void> {
    await this.calls.expireStaleCalls();
  }

  async cleanupPublished(): Promise<number> {
    const retentionHours = this.config.get<number>('realtime.outboxRetentionHours', 24);
    const cutoff = new Date(Date.now() - retentionHours * 60 * 60 * 1000);
    const batchSize = this.config.get<number>('jobs.outboxCleanupBatchSize', 1_000);
    let deleted = 0;
    for (let batch = 0; batch < 10; batch += 1) {
      const candidates = await this.prisma.realtimeOutboxEvent.findMany({
        where: { publishedAt: { lt: cutoff } },
        orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
        take: batchSize,
        select: { id: true },
      });
      if (candidates.length === 0) break;
      const result = await this.prisma.realtimeOutboxEvent.deleteMany({
        where: {
          id: { in: candidates.map((candidate) => candidate.id) },
          // The second predicate makes it impossible for cleanup to remove a
          // pending/failed row if its state changed between select and delete.
          publishedAt: { lt: cutoff },
        },
      });
      deleted += result.count;
      if (candidates.length < batchSize) break;
    }
    return deleted;
  }

  async backlog() {
    const [pending, failed, oldest] = await Promise.all([
      this.prisma.realtimeOutboxEvent.count({ where: { publishedAt: null } }),
      this.prisma.realtimeOutboxEvent.count({
        where: { publishedAt: null, attempts: { gt: 0 }, lastError: { not: null } },
      }),
      this.prisma.realtimeOutboxEvent.findFirst({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);
    return {
      pending,
      failed,
      oldestPendingAt: oldest?.createdAt.toISOString() ?? null,
    };
  }

  private logCleanupFailure(error: unknown): void {
    this.logger.error(
      'Realtime outbox cleanup failed',
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
  }
}
