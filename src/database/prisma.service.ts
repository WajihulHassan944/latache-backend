import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
  const connectionString = config.getOrThrow<string>('database.url');
  const queryLogging = config.get<boolean>('database.logging', false);

  super({
    adapter: new PrismaPg({ connectionString }),
    log: queryLogging ? ['query', 'warn', 'error'] : ['warn', 'error'],

    transactionOptions: {
      // How long Prisma waits to obtain a transaction connection.
      maxWait: config.get<number>(
        'database.transactionMaxWaitMs',
        15_000,
      ),

      // Maximum duration of an interactive transaction.
      timeout: config.get<number>(
        'database.transactionTimeoutMs',
        30_000,
      ),
    },
  });
}

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('PostgreSQL connection established through Prisma');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
