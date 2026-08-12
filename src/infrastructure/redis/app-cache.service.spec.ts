import type IORedis from 'ioredis';
import { AppCacheService, CacheNamespace } from './app-cache.service';
import type { RedisService } from './redis.service';

class MemoryRedis {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return 'OK';
  }

  async incr(key: string): Promise<number> {
    const value = Number(this.values.get(key) ?? '0') + 1;
    this.values.set(key, String(value));
    return value;
  }
}

const config = {
  get: <T>(_key: string, fallback: T): T => fallback,
};

describe('AppCacheService', () => {
  it('records a miss, then serves a hit without running the loader twice', async () => {
    const client = new MemoryRedis();
    const redis = {
      commandClient: () => client as unknown as IORedis,
      isEnabled: () => true,
    } as RedisService;
    const cache = new AppCacheService(redis, config as never);
    const loader = jest.fn().mockResolvedValue({ id: '1', name: 'Cleaning' });

    await expect(
      cache.getOrLoad(CacheNamespace.Services, { locale: 'en', page: 1 }, 60, loader),
    ).resolves.toEqual({ id: '1', name: 'Cleaning' });
    await expect(
      cache.getOrLoad(CacheNamespace.Services, { page: 1, locale: 'en' }, 60, loader),
    ).resolves.toEqual({ id: '1', name: 'Cleaning' });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, failures: 0 });
  });

  it('uses a namespace version bump for immediate mutation invalidation', async () => {
    const client = new MemoryRedis();
    const redis = {
      commandClient: () => client as unknown as IORedis,
      isEnabled: () => true,
    } as RedisService;
    const cache = new AppCacheService(redis, config as never);
    const loader = jest
      .fn()
      .mockResolvedValueOnce({ name: 'Old' })
      .mockResolvedValueOnce({ name: 'Updated' });

    await cache.getOrLoad(CacheNamespace.Services, { locale: 'en' }, 60, loader);
    await cache.invalidate(CacheNamespace.Services);
    await expect(
      cache.getOrLoad(CacheNamespace.Services, { locale: 'en' }, 60, loader),
    ).resolves.toEqual({ name: 'Updated' });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('does not leak cache entries across identities', async () => {
    const client = new MemoryRedis();
    const redis = {
      commandClient: () => client as unknown as IORedis,
      isEnabled: () => true,
    } as RedisService;
    const cache = new AppCacheService(redis, config as never);
    const loaderA = jest.fn().mockResolvedValue({ owner: 10 });
    const loaderB = jest.fn().mockResolvedValue({ owner: 11 });

    await cache.getOrLoad(CacheNamespace.AdminAnalytics, { userId: 10 }, 60, loaderA);
    await expect(
      cache.getOrLoad(CacheNamespace.AdminAnalytics, { userId: 11 }, 60, loaderB),
    ).resolves.toEqual({ owner: 11 });
    expect(loaderA).toHaveBeenCalledTimes(1);
    expect(loaderB).toHaveBeenCalledTimes(1);
  });

  it('falls back to the loader when Redis is unavailable', async () => {
    const redis = {
      commandClient: () => null,
      isEnabled: () => true,
    } as unknown as RedisService;
    const cache = new AppCacheService(redis, config as never);
    const loader = jest.fn().mockResolvedValue([]);

    await cache.getOrLoad(CacheNamespace.Services, { locale: 'ar' }, 60, loader);
    await cache.getOrLoad(CacheNamespace.Services, { locale: 'ar' }, 60, loader);
    expect(loader).toHaveBeenCalledTimes(2);
    expect(cache.stats().bypasses).toBe(2);
  });

  it('does not retry an authoritative loader failure as a cache failure', async () => {
    const client = new MemoryRedis();
    const redis = {
      commandClient: () => client as unknown as IORedis,
      isEnabled: () => true,
    } as RedisService;
    const cache = new AppCacheService(redis, config as never);
    const loader = jest.fn().mockRejectedValue(new Error('database unavailable'));

    await expect(
      cache.getOrLoad(CacheNamespace.Services, { locale: 'en' }, 60, loader),
    ).rejects.toThrow('database unavailable');
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
