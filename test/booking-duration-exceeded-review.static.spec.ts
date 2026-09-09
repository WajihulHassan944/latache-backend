import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('duration-exceeded payment review', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('holds payment when actual duration exceeds the customer-authorized ceiling', () => {
    const payments = read('src/modules/payments/payments.service.ts');
    expect(payments).toContain('if (actualMinutes > authorizedMinutes)');
    expect(payments).toContain('PAYMENT_STATUS.ReviewRequiredDurationExceeded');
    // The duration-exceeded branch must return before any Stripe/wallet/cash settlement path runs.
    const guardIndex = payments.indexOf('if (actualMinutes > authorizedMinutes)');
    const returnIndex = payments.indexOf('status: PAYMENT_STATUS.ReviewRequiredDurationExceeded,');
    const stripeIndex = payments.indexOf('createStripeBookingCharge(bookingId');
    const walletIndex = payments.indexOf('settleBookingFromCustomerWallet(');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(returnIndex).toBeGreaterThan(guardIndex);
    expect(stripeIndex).toBeGreaterThan(returnIndex);
    expect(walletIndex).toBeGreaterThan(returnIndex);
  });

  it('provides a customer approval path that recomputes duration server-side before releasing the hold', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    expect(bookings).toContain('async approveDurationReview(customerId: number, bookingId: number)');
    expect(bookings).toContain('PAYMENT_STATUS.ReviewRequiredDurationExceeded');
    expect(bookings).toContain('taskWorkSession.findUnique');
    expect(bookings).toContain('paymentStatus: PAYMENT_STATUS.Ready');
    // Authorized minutes must come from the persisted timer, never a client-supplied value.
    expect(bookings).not.toContain('dto.actualMinutes');
  });

  it('exposes the approval as a customer-only endpoint that re-attempts finalization', () => {
    const controller = read('src/modules/bookings/bookings.controller.ts');
    expect(controller).toContain("@Post(':bookingId/duration-review/approve')");
    expect(controller).toContain('approveDurationReview');
    expect(controller).toContain('this.payments.finalizeCompletedBooking(params.bookingId)');
  });
});
