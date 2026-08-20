import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Queue, Worker } from 'bullmq';
import type IORedis from 'ioredis';
import { RealtimeDispatcherService } from '../../modules/realtime/realtime-dispatcher.service';
import { TaskerEarningsWorker } from '../../modules/tasker-finance/tasker-earnings.worker';
import { PerformanceMetricsService } from '../observability/performance-metrics.service';
import { RedisService } from '../redis/redis.service';
import { ObjectStorageDeletionService } from '../../modules/account-deletion/object-storage-deletion.service';
import { BookingsService } from '../../modules/bookings/bookings.service';
import { ReferralRewardsWorker } from '../../modules/referrals/referral-rewards.worker';
import { DisputeLifecycleService } from '../../modules/disputes/dispute-lifecycle.service';
import { EliteProgramService } from '../../modules/elite-program/services/elite-program.service';

const JOB_NAMES = {
  ReleaseEarnings: 'finance.release-mature',
  ExpireCalls: 'realtime.expire-calls',
  CleanupOutbox: 'realtime.cleanup-outbox',
  PurgeDeletedAssets: 'storage.purge-deleted-assets',
  AutoCompleteBookings: 'bookings.auto-complete',
  MaintainReferrals: 'referrals.maintain',
  MaintainDisputes: 'disputes.maintain',
  MaintainElite: 'elite.maintain',
} as const;

export interface QueueHealth {
  enabled: boolean;
  workerEnabled: boolean;
  schedulerEnabled: boolean;
  status: 'disabled' | 'up' | 'down';
  counts: Record<string, number> | null;
  workers: number;
  lastError: string | null;
}

@Injectable()
export class PerformanceJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PerformanceJobsService.name);
  private readonly enabled: boolean;
  private readonly workerEnabled: boolean;
  private readonly schedulerEnabled: boolean;
  private readonly queueName: string;
  private queue?: Queue<Record<string, never>, unknown, string>;
  private worker?: Worker<Record<string, never>, unknown, string>;
  private producerConnection?: IORedis;
  private workerConnection?: IORedis;
  private lastError: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
    private readonly earnings: TaskerEarningsWorker,
    private readonly realtime: RealtimeDispatcherService,
    private readonly metrics: PerformanceMetricsService,
    private readonly storageDeletion: ObjectStorageDeletionService,
    private readonly bookings: BookingsService,
    private readonly referrals: ReferralRewardsWorker,
    private readonly disputes: DisputeLifecycleService,
    private readonly elite: EliteProgramService,
  ) {
    this.enabled = this.config.get<boolean>('jobs.enabled', false);
    this.workerEnabled = this.config.get<boolean>('jobs.workerEnabled', false);
    this.schedulerEnabled = this.config.get<boolean>('jobs.schedulerEnabled', false);
    this.queueName = this.config.get<string>('jobs.maintenanceQueueName', 'latache-maintenance-v1');
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    const producer = this.redis.createDedicatedClient('bull-producer', {
      maxRetriesPerRequest: 1,
    });
    if (!producer) {
      this.lastError = 'Queue enabled without a usable REDIS_URL';
      this.logger.error(this.lastError);
      return;
    }
    this.producerConnection = producer;
    this.queue = new Queue(this.queueName, {
      connection: producer,
      defaultJobOptions: {
        attempts: this.config.get<number>('jobs.attempts', 5),
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { age: 86_400, count: 5_000 },
        removeOnFail: { age: 7 * 86_400, count: 10_000 },
      },
    });

    if (this.schedulerEnabled) {
      try {
        await this.withTimeout(
          this.installSchedulers(),
          this.config.get<number>('jobs.healthTimeoutMs', 2_000) * 2,
        );
      } catch (error) {
        this.lastError = this.message(error);
        this.logger.error(`BullMQ scheduler registration failed: ${this.lastError}`);
      }
    }
    if (this.workerEnabled) this.startWorker();
    this.logger.log(
      `BullMQ maintenance queue ready (scheduler=${this.schedulerEnabled}, worker=${this.workerEnabled})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = undefined;
    this.queue = undefined;
    this.workerConnection?.disconnect(false);
    this.producerConnection?.disconnect(false);
  }

  async health(): Promise<QueueHealth> {
    if (!this.enabled) {
      return {
        enabled: false,
        workerEnabled: this.workerEnabled,
        schedulerEnabled: this.schedulerEnabled,
        status: 'disabled',
        counts: null,
        workers: 0,
        lastError: null,
      };
    }
    if (!this.queue) return this.downHealth();
    try {
      const [counts, workers] = await this.withTimeout(
        Promise.all([
          this.queue.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed', 'paused'),
          this.queue.getWorkersCount(),
        ]),
        this.config.get<number>('jobs.healthTimeoutMs', 2_000),
      );
      this.lastError = null;
      return {
        enabled: true,
        workerEnabled: this.workerEnabled,
        schedulerEnabled: this.schedulerEnabled,
        status: 'up',
        counts,
        workers,
        lastError: null,
      };
    } catch (error) {
      this.lastError = this.message(error);
      return this.downHealth();
    }
  }

  private async installSchedulers(): Promise<void> {
    const queue = this.queue;
    if (!queue) throw new Error('Maintenance queue is not initialized');
    await Promise.all([
      queue.upsertJobScheduler(
        'release-mature-earnings-v1',
        { every: this.config.get<number>('taskerFinance.workerPollMs', 60_000) },
        { name: JOB_NAMES.ReleaseEarnings, data: {} },
      ),
      queue.upsertJobScheduler(
        'expire-conversation-calls-v1',
        { every: this.config.get<number>('chat.callSweepMs', 5_000) },
        { name: JOB_NAMES.ExpireCalls, data: {} },
      ),
      queue.upsertJobScheduler(
        'cleanup-realtime-outbox-v1',
        { every: this.config.get<number>('jobs.outboxCleanupIntervalMs', 3_600_000) },
        { name: JOB_NAMES.CleanupOutbox, data: {} },
      ),
      queue.upsertJobScheduler(
        'purge-deleted-assets-v1',
        {
          every: this.config.get<number>('objectStorageDeletion.workerIntervalMs', 60_000),
        },
        { name: JOB_NAMES.PurgeDeletedAssets, data: {} },
      ),
      queue.upsertJobScheduler(
        'auto-complete-bookings-v1',
        {
          every: this.config.get<number>('bookingCompletion.sweepIntervalMs', 60_000),
        },
        { name: JOB_NAMES.AutoCompleteBookings, data: {} },
      ),
      queue.upsertJobScheduler(
        'maintain-referral-rewards-v1',
        { every: this.config.get<number>('referrals.workerPollMs', 60_000) },
        { name: JOB_NAMES.MaintainReferrals, data: {} },
      ),
      queue.upsertJobScheduler(
        'maintain-disputes-v1',
        { every: this.config.get<number>('disputes.workerPollMs', 60_000) },
        { name: JOB_NAMES.MaintainDisputes, data: {} },
      ),
      queue.upsertJobScheduler(
        'maintain-elite-program-v1',
        { every: this.config.get<number>('elite.workerPollMs', 21_600_000) },
        { name: JOB_NAMES.MaintainElite, data: {} },
      ),
    ]);
  }

  private startWorker(): void {
    const connection = this.redis.createDedicatedClient('bull-worker', {
      maxRetriesPerRequest: null,
    });
    if (!connection) {
      this.lastError = 'Worker enabled without a usable REDIS_URL';
      this.logger.error(this.lastError);
      return;
    }
    this.workerConnection = connection;
    this.worker = new Worker(this.queueName, (job) => this.process(job), {
      connection,
      concurrency: this.config.get<number>('jobs.workerConcurrency', 4),
      lockDuration: this.config.get<number>('jobs.lockDurationMs', 60_000),
    });
    this.worker.on('failed', (job, error) => {
      this.lastError = `${job?.name ?? 'unknown'}: ${this.message(error)}`;
      this.metrics.recordQueueFailure();
      this.logger.error(
        JSON.stringify({
          event: 'queue_job_failed',
          queue: this.queueName,
          jobId: job?.id ?? null,
          jobName: job?.name ?? null,
          attemptsMade: job?.attemptsMade ?? null,
          error: this.message(error),
        }),
      );
    });
    this.worker.on('error', (error) => {
      this.lastError = this.message(error);
      this.metrics.recordQueueFailure();
      this.logger.error(`BullMQ worker error: ${this.lastError}`);
    });
  }

  private async process(
    job: Job<Record<string, never>, unknown, string>,
  ): Promise<Record<string, unknown>> {
    switch (job.name) {
      case JOB_NAMES.ReleaseEarnings:
        return { released: await this.earnings.runOnce() };
      case JOB_NAMES.ExpireCalls:
        return { expired: await this.realtime.expireStaleCalls() };
      case JOB_NAMES.CleanupOutbox:
        return { deleted: await this.realtime.cleanupPublished() };
      case JOB_NAMES.PurgeDeletedAssets:
        return { deleted: await this.storageDeletion.processPending() };
      case JOB_NAMES.AutoCompleteBookings:
        return this.bookings.autoCompleteDueBookings();
      case JOB_NAMES.MaintainReferrals:
        return this.referrals.runOnce();
      case JOB_NAMES.MaintainDisputes:
        return this.disputes.runMaintenance();
      case JOB_NAMES.MaintainElite:
        return this.elite.runMaintenance(this.config.get<number>('elite.workerBatchSize', 200));
      default: {
        throw new Error(`Unsupported maintenance job: ${job.name}`);
      }
    }
  }

  private downHealth(): QueueHealth {
    return {
      enabled: true,
      workerEnabled: this.workerEnabled,
      schedulerEnabled: this.schedulerEnabled,
      status: 'down',
      counts: null,
      workers: 0,
      lastError: this.lastError ?? 'Queue has not initialized',
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Queue health check timed out')), timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private message(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
  }
}
