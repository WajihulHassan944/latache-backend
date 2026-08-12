import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { RedisService } from './redis.service';

export const CacheNamespace = {
  Services: 'services',
  PlatformContent: 'platform-content',
  EliteProgram: 'elite-program',
  AdminAnalytics: 'admin-analytics',
} as const;

export type CacheNamespaceValue = (typeof CacheNamespace)[keyof typeof CacheNamespace];

export interface CacheReadResult<T> {
  value: T;
  cache: 'hit' | 'miss' | 'bypass';
}

@Injectable()
export class AppCacheService {
  private readonly logger = new Logger(AppCacheService.name);
  private readonly enabled: boolean;
  private readonly prefix: string;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private hits = 0;
  private misses = 0;
  private bypasses = 0;
  private failures = 0;

  constructor(
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('cache.enabled', true);
    this.prefix = config.get<string>('cache.prefix', 'latache:v1');
  }

  async getOrLoad<T>(
    namespace: CacheNamespaceValue,
    identity: unknown,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    return (await this.getOrLoadWithStatus(namespace, identity, ttlSeconds, loader)).value;
  }

  async getOrLoadWithStatus<T>(
    namespace: CacheNamespaceValue,
    identity: unknown,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<CacheReadResult<T>> {
    const client = this.redis.commandClient();
    if (!this.enabled || !client || ttlSeconds <= 0) {
      this.bypasses += 1;
      return { value: await loader(), cache: 'bypass' };
    }

    let key: string;
    try {
      const version = (await client.get(this.versionKey(namespace))) ?? '0';
      key = this.valueKey(namespace, version, identity);
      const cached = await client.get(key);
      if (cached !== null) {
        this.hits += 1;
        return { value: JSON.parse(cached) as T, cache: 'hit' };
      }
      this.misses += 1;
    } catch (error) {
      this.failures += 1;
      this.logger.warn(
        `Cache ${namespace} operation failed; using PostgreSQL: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { value: await loader(), cache: 'bypass' };
    }

    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    const promise = existing ?? loader();
    if (!existing) this.inFlight.set(key, promise);
    let value: T;
    try {
      // Loader failures are authoritative database/application failures and
      // must propagate once; they are never retried as if Redis had failed.
      value = await promise;
    } finally {
      if (!existing) this.inFlight.delete(key);
    }
    try {
      await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.failures += 1;
      this.logger.warn(
        `Cache ${namespace} write failed; returning PostgreSQL result: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { value, cache: 'miss' };
  }

  async invalidate(namespace: CacheNamespaceValue): Promise<boolean> {
    const client = this.redis.commandClient();
    if (!this.enabled || !client) return false;
    try {
      await client.incr(this.versionKey(namespace));
      return true;
    } catch (error) {
      this.failures += 1;
      this.logger.warn(
        `Cache invalidation failed for ${namespace}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  stats() {
    return {
      enabled: this.enabled && this.redis.isEnabled(),
      hits: this.hits,
      misses: this.misses,
      bypasses: this.bypasses,
      failures: this.failures,
      inFlightLoads: this.inFlight.size,
    };
  }

  private versionKey(namespace: CacheNamespaceValue): string {
    return `${this.prefix}:cache-version:${namespace}`;
  }

  private valueKey(namespace: CacheNamespaceValue, version: string, identity: unknown): string {
    const digest = createHash('sha256')
      .update(this.stableStringify(identity))
      .digest('hex')
      .slice(0, 32);
    return `${this.prefix}:cache:${namespace}:v${version}:${digest}`;
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value))
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.stableStringify(item)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value) ?? 'undefined';
  }
}
