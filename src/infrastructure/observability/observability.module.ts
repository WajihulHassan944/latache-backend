import { Global, Module } from '@nestjs/common';
import { PerformanceMetricsService } from './performance-metrics.service';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

@Global()
@Module({
  providers: [PerformanceMetricsService, RequestLoggingInterceptor],
  exports: [PerformanceMetricsService, RequestLoggingInterceptor],
})
export class ObservabilityModule {}
