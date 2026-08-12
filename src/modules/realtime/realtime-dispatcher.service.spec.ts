import { RealtimeDispatcherService } from './realtime-dispatcher.service';

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
