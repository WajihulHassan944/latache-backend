import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis, { type RedisOptions } from 'ioredis';

export interface RedisHealth {
  enabled: boolean;
  required: boolean;
  status: 'disabled' | 'up' | 'down';
  latencyMs: number | null;
  lastError: string | null;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly enabled: boolean;
  private readonly required: boolean;
  private readonly url?: string;
  private readonly connectTimeoutMs: number;
  private client?: IORedis;
  private lastError: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.url = this.config.get<string>('redis.url');
    this.enabled = this.config.get<boolean>('redis.enabled', Boolean(this.url));
    this.required = this.config.get<boolean>('redis.required', false);
    this.connectTimeoutMs = this.config.get<number>('redis.connectTimeoutMs', 2_000);
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) return;
    if (!this.url) {
      this.lastError = 'REDIS_URL is not configured';
      this.logger.warn(this.lastError);
      return;
    }
    this.client = this.createClient('cache', { maxRetriesPerRequest: 1 });
    const client = this.client;
    try {
      await this.withTimeout(
        client.connect().then(() => client.ping()),
        this.connectTimeoutMs + 250,
      );
      this.lastError = null;
      this.logger.log('Redis connection established');
    } catch (error) {
      this.lastError = this.message(error);
      this.logger.warn(`Redis unavailable during bootstrap: ${this.lastError}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    try {
      if (client.status === 'ready') await client.quit();
      else client.disconnect(false);
    } catch {
      client.disconnect(false);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  isRequired(): boolean {
    return this.required;
  }

  isReady(): boolean {
    return this.client?.status === 'ready';
  }

  commandClient(): IORedis | null {
    return this.isReady() ? (this.client ?? null) : null;
  }

  createDedicatedClient(name: string, options: RedisOptions = {}): IORedis | null {
    if (!this.enabled || !this.url) return null;
    return this.createClient(name, options);
  }

  async health(): Promise<RedisHealth> {
    if (!this.enabled) {
      return {
        enabled: false,
        required: this.required,
        status: 'disabled',
        latencyMs: null,
        lastError: null,
      };
    }
    const client = this.client;
    if (!client || client.status !== 'ready') {
      return {
        enabled: true,
        required: this.required,
        status: 'down',
        latencyMs: null,
        lastError: this.lastError ?? `Redis client is ${client?.status ?? 'not-created'}`,
      };
    }
    const started = Date.now();
    try {
      await client.ping();
      this.lastError = null;
      return {
        enabled: true,
        required: this.required,
        status: 'up',
        latencyMs: Date.now() - started,
        lastError: null,
      };
    } catch (error) {
      this.lastError = this.message(error);
      return {
        enabled: true,
        required: this.required,
        status: 'down',
        latencyMs: null,
        lastError: this.lastError,
      };
    }
  }

  private createClient(name: string, options: RedisOptions): IORedis {
    const url = this.url;
    if (!url) throw new Error('REDIS_URL is not configured');
    const client = new IORedis(url, {
      lazyConnect: true,
      enableReadyCheck: true,
      connectTimeout: this.connectTimeoutMs,
      connectionName: `latache-${name}`,
      retryStrategy: (attempt) => Math.min(250 * 2 ** Math.min(attempt, 5), 5_000),
      ...options,
    });
    client.on('error', (error) => {
      this.lastError = this.message(error);
      this.logger.warn(`Redis ${name} error: ${this.lastError}`);
    });
    return client;
  }

  private message(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 500);
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Redis connection timed out')), timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
