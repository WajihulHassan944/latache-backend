import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { AppCacheService } from '../../infrastructure/redis/app-cache.service';
import { PerformanceJobsService } from '../../infrastructure/jobs/performance-jobs.service';
import { PerformanceMetricsService } from '../../infrastructure/observability/performance-metrics.service';
import { RealtimeDispatcherService } from '../realtime/realtime-dispatcher.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jobs: PerformanceJobsService,
    private readonly cache: AppCacheService,
    private readonly metrics: PerformanceMetricsService,
    private readonly outbox: RealtimeDispatcherService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'API dependency and background-processing health',
    description:
      'Checks PostgreSQL, Redis, BullMQ backlog/worker presence and the durable realtime outbox. No connection strings or credentials are exposed. Redis cache-only failure is degraded; Redis/queue failure is unhealthy when configured as required.',
  })
  @ApiOkResponse({ description: 'Healthy or safely degraded service.' })
  @ApiServiceUnavailableResponse({
    description: 'An authoritative or required dependency is down.',
  })
  async check() {
    const timestamp = new Date().toISOString();
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }

    const [redis, queue, outbox] = await Promise.all([
      this.redis.health(),
      this.jobs.health(),
      database === 'up'
        ? this.outbox.backlog().catch(() => ({ pending: -1, failed: -1, oldestPendingAt: null }))
        : Promise.resolve({ pending: -1, failed: -1, oldestPendingAt: null }),
    ]);
    const jobsRequired = this.config.get<boolean>('jobs.enabled', false);
    const queueWorkerMissing = jobsRequired && queue.status === 'up' && queue.workers === 0;
    const requiredFailure =
      database === 'down' ||
      (redis.required && redis.status !== 'up') ||
      (jobsRequired && queue.status !== 'up') ||
      queueWorkerMissing;
    const degraded =
      !requiredFailure &&
      ((redis.enabled && redis.status !== 'up') || outbox.failed > 0 || outbox.pending < 0);
    const body = {
      status: requiredFailure ? 'error' : degraded ? 'degraded' : 'ok',
      application: 'up',
      serviceMode: this.config.get<string>('app.serviceMode', 'all'),
      database,
      redis,
      queue: { ...queue, workerRequiredButMissing: queueWorkerMissing },
      realtimeOutbox: outbox,
      cache: this.cache.stats(),
      metrics: this.metrics.snapshot(),
      timestamp,
    };
    if (requiredFailure) throw new ServiceUnavailableException(body);
    return body;
  }
}
