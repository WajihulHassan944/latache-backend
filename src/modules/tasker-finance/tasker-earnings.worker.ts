import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { TaskerFinanceService } from './tasker-finance.service';
import { PerformanceMetricsService } from '../../infrastructure/observability/performance-metrics.service';

@Injectable()
export class TaskerEarningsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskerEarningsWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly finance: TaskerFinanceService,
    @Optional() private readonly metrics?: PerformanceMetricsService,
  ) {}

  onModuleInit(): void {
    if (!this.config.get<boolean>('taskerFinance.workerEnabled', true)) return;
    if (this.config.get<boolean>('jobs.enabled', false)) return;
    const pollMs = this.config.get<number>('taskerFinance.workerPollMs', 60_000);
    // runOnce() logs and re-throws on failure so BullMQ (see
    // PerformanceJobsService) can retry a failed job; this interval-driven
    // fallback path only runs when BullMQ is disabled, so it must swallow
    // that re-thrown rejection itself - otherwise a single failed tick (e.g.
    // a transient DB timeout) becomes an unhandled rejection that crashes
    // the whole process instead of just being logged and retried next tick.
    this.timer = setInterval(() => void this.runOnce().catch(() => {}), pollMs);
    this.timer.unref();
    void this.runOnce().catch(() => {});
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      let released: number;
      try {
        await this.finance.markMatureCashReceivablesCleared();
        await this.finance.reconcileCashRestrictions();
        const batchSize = this.config.get<number>('taskerFinance.workerBatchSize', 100);
        const candidates = await this.prisma.taskerEarning.findMany({
          where: {
            status: { in: ['pending', 'partially_reversed'] },
            isBlocked: false,
            releasedAt: null,
            clearsAt: { lte: new Date() },
            OR: [{ holdExtendedUntil: null }, { holdExtendedUntil: { lte: new Date() } }],
          },
          select: { id: true },
          orderBy: [{ clearsAt: 'asc' }, { id: 'asc' }],
          take: batchSize,
        });
        released = 0;
        for (const candidate of candidates) {
          try {
            if (await this.finance.releaseMatureEarning(candidate.id)) released += 1;
          } catch (error) {
            // releaseMatureEarning owns the PostgreSQL locks/idempotency checks;
            // surfacing the error lets queue retries and health monitoring act.
            this.logger.error(
              `Failed to release earning ${candidate.id}`,
              error instanceof Error ? (error.stack ?? error.message) : String(error),
            );
            this.metrics?.recordEarningReleaseFailure();
          }
        }
      } catch (error) {
        // Mirrors ReferralRewardsWorker: log here (this worker's own logger,
        // with context) then re-throw so BullMQ can still retry the job when
        // jobs.enabled=true; the interval-driven onModuleInit call sites
        // swallow this rejection themselves since they have no retry queue.
        this.logger.error(
          'Tasker earnings maintenance failed',
          error instanceof Error ? (error.stack ?? error.message) : String(error),
        );
        throw error;
      }
      return released;
    } finally {
      this.running = false;
    }
  }
}
