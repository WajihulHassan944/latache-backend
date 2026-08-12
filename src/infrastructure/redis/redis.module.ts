import { Global, Module } from '@nestjs/common';
import { AppCacheService } from './app-cache.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, AppCacheService],
  exports: [RedisService, AppCacheService],
})
export class RedisModule {}
