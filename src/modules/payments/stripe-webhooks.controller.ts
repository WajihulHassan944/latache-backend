import { BadRequestException, Controller, Headers, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import { StripeService } from './stripe.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@ApiExcludeController()
@Controller('payments/webhooks')
export class StripeWebhooksController {
  constructor(
    private readonly stripe: StripeService,
    private readonly payments: PaymentsService,
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
      event = this.stripe.client().webhooks.constructEvent(
        request.rawBody,
        signature,
        this.stripe.webhookSigningSecret(),
      );
    } catch {
      throw new BadRequestException('Stripe webhook signature verification failed');
    }
    return this.payments.handleStripeEvent(event);
  }
}
