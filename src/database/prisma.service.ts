import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';
import { PerformanceMetricsService } from '../infrastructure/observability/performance-metrics.service';

type QueryLoggingOptions = Prisma.PrismaClientOptions & {
  log: [
    { emit: 'event'; level: 'query' },
    { emit: 'stdout'; level: 'warn' },
    { emit: 'stdout'; level: 'error' },
  ];
};

@Injectable()
export class PrismaService
  extends PrismaClient<QueryLoggingOptions>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService, metrics: PerformanceMetricsService) {
    const connectionString = config.getOrThrow<string>('database.url');
    const queryLogging = config.get<boolean>('database.logging', false);
    const slowQueryMs = config.get<number>('database.slowQueryMs', 750);
    const options: QueryLoggingOptions = {
      adapter: new PrismaPg({
        connectionString,
        max: config.get<number>('database.poolMaxPerInstance', 10),
        idleTimeoutMillis: config.get<number>('database.poolIdleTimeoutMs', 30_000),
        connectionTimeoutMillis: config.get<number>('database.poolConnectionTimeoutMs', 5_000),
      }),
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
      transactionOptions: {
        maxWait: config.get<number>('database.transactionMaxWaitMs', 15_000),
        timeout: config.get<number>('database.transactionTimeoutMs', 30_000),
      },
    };
    super(options);
    this.$on('query', (event) => {
      if (event.duration < slowQueryMs && !queryLogging) return;
      const record = JSON.stringify({
        event: event.duration >= slowQueryMs ? 'slow_database_query' : 'database_query',
        durationMs: event.duration,
        target: event.target,
        // SQL parameters and full statements are intentionally excluded.
        statementType: event.query.trim().split(/\s+/, 1)[0]?.toUpperCase() ?? 'UNKNOWN',
      });
      if (event.duration >= slowQueryMs) {
        metrics.recordSlowQuery();
        this.logger.warn(record);
      } else this.logger.debug(record);
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
