import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly stripe: Stripe | null;
  private readonly webhookSecret: string | undefined;

  constructor(private readonly config: ConfigService) {
    const enabled = config.get<boolean>('payments.stripeEnabled', false);
    const secretKey = config.get<string>('payments.stripeSecretKey');
    this.webhookSecret = config.get<string>('payments.stripeWebhookSecret');
    this.stripe = enabled && secretKey ? new Stripe(secretKey) : null;
  }

  client(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe payments are not configured for this deployment',
      );
    }
    return this.stripe;
  }

  webhookSigningSecret(): string {
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException('Stripe webhook verification is not configured');
    }
    return this.webhookSecret;
  }

  isEnabled(): boolean {
    return this.stripe !== null;
  }
}
