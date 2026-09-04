import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReferralsService } from './services/referrals.service';

@Injectable()
export class ReferralRewardsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReferralRewardsWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly referrals: ReferralsService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<boolean>('jobs.enabled', false)) return;
    const pollMs = this.config.get<number>('referrals.workerPollMs', 60_000);
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

  async runOnce(): Promise<{ released: number; expired: number }> {
    if (this.running) return { released: 0, expired: 0 };
    this.running = true;
    try {
      const batchSize = this.config.get<number>('referrals.workerBatchSize', 100);
      const expired = await this.referrals.expireStaleReferrals(new Date(), batchSize);
      const released = await this.referrals.releaseMatureRewards(new Date(), batchSize);
      return { released, expired };
    } catch (error) {
      this.logger.error(
        'Referral maintenance failed',
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      );
      throw error;
    } finally {
      this.running = false;
    }
  }
}
