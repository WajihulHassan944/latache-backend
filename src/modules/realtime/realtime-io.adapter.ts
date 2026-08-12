import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type IORedis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { RedisService } from '../../infrastructure/redis/redis.service';

export class RealtimeIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RealtimeIoAdapter.name);
  private pubClient?: IORedis;
  private subClient?: IORedis;
  private redisAdapter?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigins: ReadonlySet<string>,
    private readonly redis: RedisService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<boolean> {
    if (!this.redis.isEnabled()) return false;
    const pubClient = this.redis.createDedicatedClient('socket-publisher', {
      maxRetriesPerRequest: 1,
    });
    const subClient = this.redis.createDedicatedClient('socket-subscriber', {
      maxRetriesPerRequest: 1,
    });
    if (!pubClient || !subClient) return false;
    try {
      await Promise.race([
        Promise.all([pubClient.connect(), subClient.connect()]),
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Socket.IO Redis connection timed out')),
            3_000,
          );
          timer.unref();
        }),
      ]);
      this.pubClient = pubClient;
      this.subClient = subClient;
      this.redisAdapter = createAdapter(pubClient, subClient, {
        key: 'latache:socket.io:v1',
      });
      this.logger.log('Socket.IO Redis adapter enabled for cross-instance room delivery');
      return true;
    } catch (error) {
      pubClient.disconnect(false);
      subClient.disconnect(false);
      this.logger.error(
        `Socket.IO Redis adapter unavailable; this replica is local-only: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: {
        credentials: true,
        origin: [...this.allowedOrigins],
      },
    }) as Server;
    if (this.redisAdapter) server.adapter(this.redisAdapter);
    return server;
  }
}
