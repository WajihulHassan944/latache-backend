import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PaymentsService } from '../src/modules/payments/payments.service';

const isCardFailure = (error: unknown): boolean =>
  (Object.create(PaymentsService.prototype) as unknown as { isStripeCardFailure: (e: unknown) => boolean })
    .isStripeCardFailure(error);

describe('Stripe card error mapping', () => {
  it('recognizes stripe-node error classes (type=StripeCardError, rawType=card_error)', () => {
    expect(isCardFailure({ type: 'StripeCardError', rawType: 'card_error', code: 'authentication_required' })).toBe(true);
    expect(isCardFailure({ type: 'StripeInvalidRequestError', rawType: 'invalid_request_error' })).toBe(true);
  });

  it('still recognizes plain API-shaped errors', () => {
    expect(isCardFailure({ type: 'card_error' })).toBe(true);
  });

  it('does not swallow unrelated errors', () => {
    expect(isCardFailure(new Error('db down'))).toBe(false);
    expect(isCardFailure({ type: 'StripeAPIError', rawType: 'api_error' })).toBe(false);
    expect(isCardFailure(null)).toBe(false);
  });

  it('charges the in-app acceptance payment on-session so 3DS can be completed', () => {
    const source = readFileSync(join(process.cwd(), 'src/modules/payments/payments.service.ts'), 'utf8');
    const block = source.slice(source.indexOf('async completeAcceptancePayment('), source.indexOf('private async captureAcceptanceFromWallet('));
    expect(block).toContain('off_session: false');
    expect(block).not.toContain('off_session: true');
    // A retry re-confirms the recorded PaymentIntent instead of creating a new one.
    expect(block).toContain('stripe.paymentIntents.confirm(intent.id');
  });
});
