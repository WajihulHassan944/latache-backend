import { RealtimeDispatcherService } from './realtime-dispatcher.service';

const flushMicrotasks = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

describe('RealtimeDispatcherService.onModuleInit crash safety', () => {
  it('never lets a failing session sweep tick become an unhandled promise rejection', async () => {
    const prisma = { realtimeOutboxEvent: { findMany: jest.fn(), deleteMany: jest.fn() } };
    const config = {
      get: (key: string, fallback: unknown) => {
        // Isolate the session-sweep timer: BullMQ "on" (skips the call/cleanup
        // timers) and realtime "on" with a near-zero session sweep interval.
        if (key === 'app.serviceMode') return 'all';
        if (key === 'jobs.enabled') return true;
        if (key === 'realtime.enabled') return true;
        if (key === 'realtime.sessionSweepMs') return 5;
        if (key === 'realtime.outboxPollMs') return 3_600_000;
        return fallback;
      },
    };
    const gateway = { sweepInvalidSessions: jest.fn().mockRejectedValue(new Error('db unavailable')) };
    const calls = { expireStaleCalls: jest.fn() };
    const dispatcher = new RealtimeDispatcherService(
      prisma as never,
      config as never,
      gateway as never,
      calls as never,
    );

    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    try {
      dispatcher.onModuleInit();
      await flushMicrotasks();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await flushMicrotasks();
    } finally {
      dispatcher.onModuleDestroy();
      process.off('unhandledRejection', unhandled);
    }

    expect(unhandled).not.toHaveBeenCalled();
    expect(gateway.sweepInvalidSessions).toHaveBeenCalled();
  });
});

describe('RealtimeDispatcherService outbox maintenance', () => {
  it('deletes only explicitly published rows older than retention', async () => {
    const prisma = {
      realtimeOutboxEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: 'published-1' }, { id: 'published-2' }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    };
    const config = {
      get: (key: string, fallback: unknown) =>
        key === 'realtime.outboxRetentionHours'
          ? 24
          : key === 'jobs.outboxCleanupBatchSize'
            ? 1_000
            : fallback,
    };
    const dispatcher = new RealtimeDispatcherService(
      prisma as never,
      config as never,
      {} as never,
      {} as never,
    );

    await expect(dispatcher.cleanupPublished()).resolves.toBe(2);
    expect(prisma.realtimeOutboxEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['published-1', 'published-2'] },
        publishedAt: { lt: expect.any(Date) },
      },
    });
    expect(JSON.stringify(prisma.realtimeOutboxEvent.deleteMany.mock.calls)).not.toContain(
      'publishedAt":null',
    );
  });
});
