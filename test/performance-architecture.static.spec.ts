import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

describe('performance architecture regression contract', () => {
  it('uses Redis for cache/pub-sub and BullMQ without making Redis financial truth', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies).toEqual(
      expect.objectContaining({
        bullmq: expect.any(String),
        ioredis: expect.any(String),
        '@socket.io/redis-adapter': expect.any(String),
        compression: expect.any(String),
      }),
    );
    const cache = read('src/infrastructure/redis/app-cache.service.ts');
    expect(cache).toContain('cache-version');
    expect(cache).toContain('using PostgreSQL');
    expect(cache).not.toMatch(/wallet|paymentTransaction|taskerEarning/i);
    expect(read('src/modules/services/services.service.ts')).toContain(
      'this.invalidateServiceCaches()',
    );
  });

  it('keeps durable outbox dispatch separate from Socket.IO Redis fanout', () => {
    expect(read('src/modules/realtime/realtime-io.adapter.ts')).toContain('createAdapter');
    const dispatcher = read('src/modules/realtime/realtime-dispatcher.service.ts');
    expect(dispatcher).toContain('FOR UPDATE SKIP LOCKED');
    expect(dispatcher).toContain('publishedAt: { lt: cutoff }');
    expect(dispatcher).not.toContain('await this.prunePublished()');
  });

  it('routes scheduled finance maintenance through stable retry-safe jobs', () => {
    const jobs = read('src/infrastructure/jobs/performance-jobs.service.ts');
    expect(jobs).toContain("ReleaseEarnings: 'finance.release-mature'");
    expect(jobs).toContain("'release-mature-earnings-v1'");
    expect(jobs).toContain('this.earnings.runOnce()');
    expect(read('src/modules/tasker-finance/tasker-earnings.worker.ts')).toContain(
      "this.config.get<boolean>('jobs.enabled', false)",
    );
    const finance = read('src/modules/tasker-finance/tasker-finance.service.ts');
    expect(finance).toContain('FOR UPDATE');
    expect(finance).toContain('idempotencyKey');
  });

  it('adds bounded cursor reads and query-driven indexes', () => {
    expect(read('src/modules/notifications/notifications.service.ts')).toContain('nextCursor');
    expect(read('src/modules/conversations/conversations.service.ts')).toContain('nextCursor');
    expect(read('src/modules/tasker-dashboard/services/tasker-wallet.service.ts')).toContain(
      'nextCursor',
    );
    const migration = read(
      'prisma/migrations/20260812223000_add_performance_indexes/migration.sql',
    );
    expect(migration).toContain('task_notifications_user_cursor_idx');
    expect(migration).toContain('task_messages_booking_cursor_idx');
    expect(migration).toContain('realtime_outbox_cleanup_cursor_idx');
    expect(migration).toContain('gin_trgm_ops');
  });
});
