import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { HealthController } from '../src/modules/health/health.controller';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../src/infrastructure/redis/redis.service';
import { AppCacheService } from '../src/infrastructure/redis/app-cache.service';
import { PerformanceJobsService } from '../src/infrastructure/jobs/performance-jobs.service';
import { PerformanceMetricsService } from '../src/infrastructure/observability/performance-metrics.service';
import { RealtimeDispatcherService } from '../src/modules/realtime/realtime-dispatcher.service';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn().mockResolvedValue([{ result: 1 }]) },
        },
        {
          provide: RedisService,
          useValue: {
            health: jest.fn().mockResolvedValue({
              enabled: true,
              required: true,
              status: 'up',
              latencyMs: 1,
              lastError: null,
            }),
          },
        },
        {
          provide: PerformanceJobsService,
          useValue: {
            health: jest.fn().mockResolvedValue({
              enabled: true,
              workerEnabled: false,
              schedulerEnabled: true,
              status: 'up',
              counts: { wait: 0, active: 0, delayed: 3, failed: 0 },
              workers: 1,
              lastError: null,
            }),
          },
        },
        { provide: AppCacheService, useValue: { stats: () => ({ hits: 1, misses: 1 }) } },
        { provide: PerformanceMetricsService, useValue: { snapshot: () => ({ requests: 1 }) } },
        {
          provide: RealtimeDispatcherService,
          useValue: {
            backlog: jest.fn().mockResolvedValue({
              pending: 0,
              failed: 0,
              oldestPendingAt: null,
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback: unknown) =>
              key === 'jobs.enabled' ? true : key === 'app.serviceMode' ? 'api' : fallback,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => app.close());

  it('GET /api/health', async () => {
    const response = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.application).toBe('up');
    expect(response.body.database).toBe('up');
    expect(response.body.redis.status).toBe('up');
    expect(response.body.queue.workers).toBe(1);
    expect(response.body.realtimeOutbox.pending).toBe(0);
  });
});
