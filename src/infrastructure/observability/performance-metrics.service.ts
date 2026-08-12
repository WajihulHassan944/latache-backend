import { Injectable } from '@nestjs/common';

@Injectable()
export class PerformanceMetricsService {
  private requests = 0;
  private requestErrors = 0;
  private totalLatencyMs = 0;
  private slowRequests = 0;
  private slowQueries = 0;
  private queueFailures = 0;
  private earningReleaseFailures = 0;
  private stripeWebhookFailures = 0;

  recordRequest(durationMs: number, statusCode: number, slowThresholdMs: number): void {
    this.requests += 1;
    this.totalLatencyMs += durationMs;
    if (statusCode >= 500) this.requestErrors += 1;
    if (durationMs >= slowThresholdMs) this.slowRequests += 1;
  }

  recordSlowQuery(): void {
    this.slowQueries += 1;
  }

  recordQueueFailure(): void {
    this.queueFailures += 1;
  }

  recordEarningReleaseFailure(): void {
    this.earningReleaseFailures += 1;
  }

  recordStripeWebhookFailure(): void {
    this.stripeWebhookFailures += 1;
  }

  snapshot() {
    return {
      requests: this.requests,
      requestErrors: this.requestErrors,
      averageLatencyMs:
        this.requests === 0 ? 0 : Math.round((this.totalLatencyMs / this.requests) * 100) / 100,
      slowRequests: this.slowRequests,
      slowQueries: this.slowQueries,
      queueFailures: this.queueFailures,
      earningReleaseFailures: this.earningReleaseFailures,
      stripeWebhookFailures: this.stripeWebhookFailures,
    };
  }
}
