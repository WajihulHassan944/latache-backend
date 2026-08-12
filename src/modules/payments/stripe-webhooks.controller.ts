import { BadRequestException, Controller, Headers, Logger, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';
import { PerformanceMetricsService } from '../../infrastructure/observability/performance-metrics.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiExcludeController()
@Controller('payments/webhooks')
export class StripeWebhooksController {
  private readonly logger = new Logger(StripeWebhooksController.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
    private readonly metrics: PerformanceMetricsService,
  ) {}

  @Post('stripe')
  async stripeWebhook(
    @Req() request: RawBodyRequest,
    @Headers('stripe-signature') signature: string | undefined,
  ): Promise<{ received: true; duplicate: boolean }> {
    if (!request.rawBody?.length) {
      throw new BadRequestException('Stripe webhook raw body is unavailable');
    }
    if (!signature) throw new BadRequestException('Stripe-Signature header is required');

    let event;
    try {
      event = this.stripe
        .client()
        .webhooks.constructEvent(request.rawBody, signature, this.stripe.webhookSigningSecret());
    } catch {
      this.metrics.recordStripeWebhookFailure();
      this.logger.warn(JSON.stringify({ event: 'stripe_webhook_signature_failed' }));
      throw new BadRequestException('Stripe webhook signature verification failed');
    }
    try {
      return await this.payments.handleStripeEvent(event);
    } catch (error) {
      this.metrics.recordStripeWebhookFailure();
      this.logger.error(
        JSON.stringify({
          event: 'stripe_webhook_processing_failed',
          stripeEventId: event.id,
          stripeEventType: event.type,
          error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
        }),
      );
      throw error;
    }
  }
}
