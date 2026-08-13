import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

const controller = (redisRequired: boolean, jobsEnabled = false) =>
  new HealthController(
    { $queryRaw: jest.fn().mockResolvedValue([{ value: 1 }]) } as never,
    {
      health: jest.fn().mockResolvedValue({
        enabled: true,
        required: redisRequired,
        status: 'down',
        latencyMs: null,
        lastError: 'unavailable',
      }),
    } as never,
    {
      health: jest.fn().mockResolvedValue({
        enabled: jobsEnabled,
        workerEnabled: false,
        schedulerEnabled: jobsEnabled,
        status: jobsEnabled ? 'down' : 'disabled',
        counts: null,
        workers: 0,
        lastError: jobsEnabled ? 'unavailable' : null,
      }),
    } as never,
    { stats: () => ({ bypasses: 1 }) } as never,
    { snapshot: () => ({ requests: 0 }) } as never,
    {
      backlog: jest.fn().mockResolvedValue({ pending: 0, failed: 0, oldestPendingAt: null }),
    } as never,
    {
      get: (key: string, fallback: unknown) =>
        key === 'jobs.enabled' ? jobsEnabled : key === 'app.serviceMode' ? 'api' : fallback,
    } as never,
    {
      backlog: jest.fn().mockResolvedValue({ pending: 0, failed: 0, oldestPendingAt: null }),
    } as never,
  );

describe('HealthController failure policy', () => {
  it('reports optional cache Redis failure as degraded without hiding database health', async () => {
    await expect(controller(false).check()).resolves.toMatchObject({
      status: 'degraded',
      database: 'up',
      redis: { status: 'down', required: false },
    });
  });

  it('fails health when Redis is configured as required', async () => {
    await expect(controller(true).check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('fails health when durable jobs are enabled but the queue is unavailable', async () => {
    await expect(controller(false, true).check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
