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
import { FcmService } from '../../modules/fcm/fcm.service';
import { PrismaService } from '../../database/prisma.service';
import { GuestService } from '../../modules/guest/guest.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { CustomTimeRequestsService } from '../../modules/bookings/custom-time-requests.service';
import { TaskerPlansService } from '../../modules/tasker-plans/tasker-plans.service';
import { PaymentsService } from '../../modules/payments/payments.service';
import { AdminCustomersService } from '../../modules/admin-dashboard/services/admin-customers.service';
import { AccountingPostingService } from '../../modules/accounting/accounting-posting.service';
import { InvoicesService } from '../../modules/invoices/invoices.service';
import { SupportService } from '../../modules/support/support.service';

const JOB_NAMES = {
  ReleaseEarnings: 'finance.release-mature',
  ExpireCalls: 'realtime.expire-calls',
  CleanupOutbox: 'realtime.cleanup-outbox',
  PurgeDeletedAssets: 'storage.purge-deleted-assets',
  AutoCompleteBookings: 'bookings.auto-complete',
  ExpirePendingBookings: 'bookings.expire-pending',
  ExpireAwaitingPaymentBookings: 'bookings.expire-awaiting-payment',
  ExpireNotStartedBookings: 'bookings.expire-not-started',
  ProcessAcceptanceRefunds: 'payments.process-acceptance-refunds',
  MaintainReferrals: 'referrals.maintain',
  MaintainDisputes: 'disputes.maintain',
  MaintainElite: 'elite.maintain',
  DispatchFcmPush: 'notifications.dispatch-fcm-push',
  DispatchNotificationEmails: 'notifications.dispatch-emails',
  SendBookingReminders: 'bookings.send-reminders',
  SendReviewRequests: 'bookings.send-review-requests',
  CleanupGuestSessions: 'guest.cleanup-sessions',
  ExpireCustomTimeRequests: 'bookings.expire-custom-time-requests',
  MaintainTaskerPlans: 'tasker-plans.maintain',
  ReactivateDueSuspensions: 'customers.reactivate-due-suspensions',
  CleanupAuthSessions: 'auth.cleanup-sessions',
  IssuePendingInvoices: 'invoices.issue-pending',
  PostAccountingJournal: 'accounting.post-journal',
  SupportQueueMaintenance: 'support.queue-maintenance',
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
    private readonly fcm: FcmService,
    private readonly guests: GuestService,
    private readonly notificationsService: NotificationsService,
    private readonly customTimeRequests: CustomTimeRequestsService,
    private readonly taskerPlans: TaskerPlansService,
    private readonly payments: PaymentsService,
    private readonly adminCustomers: AdminCustomersService,
    private readonly prisma: PrismaService,
  private readonly invoices: InvoicesService,
    private readonly accounting: AccountingPostingService,
    private readonly support: SupportService,
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
    // BullMQ's Queue is an EventEmitter that emits 'error' on Redis
    // connection trouble; Node throws (or crashes the process) on an
    // unhandled 'error' event, same failure class as this.worker below - so
    // this needs the same listener even though nothing here needs to react.
    this.queue.on('error', (error) => {
      this.lastError = this.message(error);
      this.metrics.recordQueueFailure();
      this.logger.error(`BullMQ queue error: ${this.lastError}`);
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
        'expire-pending-bookings-v1',
        {
          every: this.config.get<number>('bookingExpiration.sweepIntervalMs', 60_000),
        },
        { name: JOB_NAMES.ExpirePendingBookings, data: {} },
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
      queue.upsertJobScheduler(
        'dispatch-fcm-push-v1',
        { every: this.config.get<number>('fcm.pollMs', 1_000) },
        { name: JOB_NAMES.DispatchFcmPush, data: {} },
      ),
      queue.upsertJobScheduler(
        'dispatch-notification-emails-v1',
        { every: this.config.get<number>('notificationEmails.pollMs', 5_000) },
        { name: JOB_NAMES.DispatchNotificationEmails, data: {} },
      ),
      queue.upsertJobScheduler(
        'send-booking-reminders-v1',
        { every: this.config.get<number>('bookingReminders.sweepIntervalMs', 300_000) },
        { name: JOB_NAMES.SendBookingReminders, data: {} },
      ),
      queue.upsertJobScheduler(
        'send-booking-review-requests-v1',
        { every: this.config.get<number>('bookingReviewRequests.sweepIntervalMs', 900_000) },
        { name: JOB_NAMES.SendReviewRequests, data: {} },
      ),
      queue.upsertJobScheduler(
        'expire-awaiting-payment-bookings-v1',
        { every: this.config.get<number>('bookingExpiration.sweepIntervalMs', 60_000) },
        { name: JOB_NAMES.ExpireAwaitingPaymentBookings, data: {} },
      ),
      queue.upsertJobScheduler(
        'support-queue-maintenance-v1',
        { every: this.config.get<number>('support.queueSweepIntervalMs', 300_000) },
        { name: JOB_NAMES.SupportQueueMaintenance, data: {} },
      ),
      queue.upsertJobScheduler(
        'issue-pending-invoices-v1',
        { every: this.config.get<number>('invoices.sweepIntervalMs', 10_000) },
        { name: JOB_NAMES.IssuePendingInvoices, data: {} },
      ),
      queue.upsertJobScheduler(
        'post-accounting-journal-v1',
        { every: 5 * 60_000 },
        { name: JOB_NAMES.PostAccountingJournal, data: {} },
      ),
      queue.upsertJobScheduler(
        'expire-not-started-bookings-v1',
        { every: this.config.get<number>('bookingExpiration.notStartedSweepIntervalMs', 300_000) },
        { name: JOB_NAMES.ExpireNotStartedBookings, data: {} },
      ),
      queue.upsertJobScheduler(
        'process-acceptance-refunds-v1',
        { every: this.config.get<number>('payments.acceptanceRefundSweepMs', 120_000) },
        { name: JOB_NAMES.ProcessAcceptanceRefunds, data: {} },
      ),
      queue.upsertJobScheduler(
        'expire-custom-time-requests-v1',
        { every: this.config.get<number>('customTimeRequests.sweepIntervalMs', 60_000) },
        { name: JOB_NAMES.ExpireCustomTimeRequests, data: {} },
      ),
      queue.upsertJobScheduler(
        'maintain-tasker-plans-v1',
        { every: this.config.get<number>('taskerPlans.sweepIntervalMs', 900_000) },
        { name: JOB_NAMES.MaintainTaskerPlans, data: {} },
      ),
      queue.upsertJobScheduler(
        'cleanup-guest-sessions-v1',
        { every: this.config.get<number>('jobs.guestSessionCleanupIntervalMs', 3_600_000) },
        { name: JOB_NAMES.CleanupGuestSessions, data: {} },
      ),
      queue.upsertJobScheduler(
        'cleanup-auth-sessions-v1',
        { every: this.config.get<number>('jobs.authSessionCleanupIntervalMs', 3_600_000) },
        { name: JOB_NAMES.CleanupAuthSessions, data: {} },
      ),
      queue.upsertJobScheduler(
        'reactivate-due-suspensions-v1',
        { every: this.config.get<number>('customers.suspensionSweepIntervalMs', 3_600_000) },
        { name: JOB_NAMES.ReactivateDueSuspensions, data: {} },
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
      case JOB_NAMES.ProcessAcceptanceRefunds:
        return this.payments.processPendingAcceptanceRefunds();
      case JOB_NAMES.ExpireAwaitingPaymentBookings:
        return this.bookings.expireDueAwaitingPaymentBookings();
      case JOB_NAMES.SupportQueueMaintenance:
        return this.support.runQueueMaintenance(
          this.config.get<number>('support.autoAssignAfterMinutes', 15),
          this.config.get<number>('support.agingAfterHours', 24),
        );
      case JOB_NAMES.PostAccountingJournal:
        return this.accounting.sync(true);
      case JOB_NAMES.IssuePendingInvoices:
        return { issued: await this.invoices.issuePending(), emailed: await this.invoices.emailPending() };
      case JOB_NAMES.ExpireNotStartedBookings:
        return this.bookings.expireDueNotStartedBookings();
      case JOB_NAMES.ExpirePendingBookings:
        return this.bookings.expireDuePendingBookings();
      case JOB_NAMES.MaintainReferrals:
        return this.referrals.runOnce();
      case JOB_NAMES.MaintainDisputes:
        return this.disputes.runMaintenance();
      case JOB_NAMES.MaintainElite:
        return this.elite.runMaintenance(this.config.get<number>('elite.workerBatchSize', 200));
      case JOB_NAMES.DispatchFcmPush:
        return this.fcm.runOnce();
      case JOB_NAMES.DispatchNotificationEmails:
        return { sent: await this.notificationsService.processEmailDeliveries() };
      case JOB_NAMES.SendBookingReminders:
        return this.bookings.sendDueBookingReminders();
      case JOB_NAMES.SendReviewRequests:
        return this.bookings.sendDueReviewRequests();
      case JOB_NAMES.ExpireCustomTimeRequests:
        return this.customTimeRequests.expireDueRequests();
      case JOB_NAMES.MaintainTaskerPlans:
        return this.taskerPlans.runMaintenance();
      case JOB_NAMES.CleanupGuestSessions:
        return this.guests.runOnce();
      case JOB_NAMES.CleanupAuthSessions: {
        // Revoked/expired rows are kept 30 days so refresh-token reuse detection and IP history still work.
        const cutoff = new Date(Date.now() - 30 * 86_400_000);
        const result = await this.prisma.refreshToken.deleteMany({
          where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
        });
        // Failed jobs older than a week are history, not a live problem: stop counting them on System Health.
        const failedRemoved = await this.adminCleanFailed(7 * 86_400_000);
        return { deleted: result.count, failedJobsRemoved: failedRemoved };
      }
      case JOB_NAMES.ReactivateDueSuspensions:
        return this.adminCustomers.reactivateDueSuspensions();
      default: {
        throw new Error(`Unsupported maintenance job: ${job.name}`);
      }
    }
  }

  // ───────── Admin: queue inspection (System health page) ─────────

  /** Counts per state plus the configured schedulers; null when the queue is not running in this process. */
  async adminOverview() {
    if (!this.queue) return { available: false as const, queueName: this.queueName };
    const counts = await this.queue.getJobCounts('wait', 'active', 'delayed', 'failed', 'completed', 'paused');
    const schedulers = await this.queue.getJobSchedulers(0, 50).catch(() => []);
    return {
      available: true as const,
      queueName: this.queueName,
      counts,
      workerEnabled: this.workerEnabled,
      schedulerEnabled: this.schedulerEnabled,
      lastError: this.lastError,
      schedulers: schedulers.map((sch) => ({ name: sch.name ?? sch.key, every: sch.every ?? null, pattern: sch.pattern ?? null, next: sch.next ? new Date(sch.next).toISOString() : null })),
    };
  }

  /** Newest failed jobs plus a grouped summary (same job + same reason) of the newest 500. */
  async adminFailed(limit = 25, offset = 0) {
    if (!this.queue) return { available: false as const, items: [], groups: [], total: 0 };
    const [page, sample, total] = await Promise.all([
      this.queue.getFailed(offset, offset + limit - 1),
      this.queue.getFailed(0, 499),
      this.queue.getFailedCount(),
    ]);
    const shape = (job: Job) => ({
      id: String(job.id),
      name: job.name,
      reason: (job.failedReason ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      attemptsMade: job.attemptsMade,
      failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
    });
    const groups = new Map<string, { name: string; reason: string; count: number; lastAt: string | null }>();
    for (const job of sample) {
      const row = shape(job);
      const key = `${row.name}|${row.reason.slice(0, 80)}`;
      const g = groups.get(key);
      if (g) {
        g.count += 1;
        if (row.failedAt && (!g.lastAt || row.failedAt > g.lastAt)) g.lastAt = row.failedAt;
      } else groups.set(key, { name: row.name, reason: row.reason, count: 1, lastAt: row.failedAt });
    }
    return { available: true as const, total, items: page.map(shape), groups: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 10) };
  }

  async adminRetryFailed(jobId: string): Promise<boolean> {
    if (!this.queue) return false;
    const job = await this.queue.getJob(jobId);
    if (!job) return false;
    await job.retry('failed');
    return true;
  }

  /** Removes failed jobs older than `graceMs`. Returns how many were removed. */
  async adminCleanFailed(graceMs: number): Promise<number> {
    if (!this.queue) return 0;
    const removed = await this.queue.clean(graceMs, 10_000, 'failed');
    return removed.length;
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
