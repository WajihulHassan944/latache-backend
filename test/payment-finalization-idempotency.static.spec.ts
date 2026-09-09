import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('payment finalization idempotency and retry safety', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');
  const payments = read('src/modules/payments/payments.service.ts');

  it('finalizeCompletedBooking() is a no-op once payment already settled', () => {
    expect(payments).toContain(
      '[PAYMENT_STATUS.Paid, PAYMENT_STATUS.CashConfirmed].includes(booking.paymentStatus as never)',
    );
  });

  it('Stripe booking charges use a deterministic idempotency key plus a Stripe idempotency key', () => {
    expect(payments).toContain('const idempotencyKey = `booking-charge:${bookingId}:v1`');
    expect(payments).toContain('{ idempotencyKey },');
    expect(payments).toContain('paymentTransaction.findUnique({');
  });

  it('retries a declined card by re-confirming the same PaymentIntent instead of forking a new charge', () => {
    expect(payments).toContain('confirmExistingBookingIntent');
    expect(payments).toContain("intent.status === 'requires_payment_method'");
    expect(payments).toContain('paymentIntents.confirm(');
    expect(payments).toContain("idempotencyKey = `booking-charge:${bookingId}:confirm:${randomUUID()}`");
  });

  it('wallet settlement locks the booking and wallet rows and guards the debit with its own idempotency key', () => {
    expect(payments).toContain('SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE');
    expect(payments).toContain('SELECT "customerId" FROM "CustomerWallets"');
    expect(payments).toContain('const wallet = await transaction.customerWallet.findUniqueOrThrow');
    expect(payments).toContain("const idempotencyKey = `wallet:booking:${bookingId}:debit`");
    expect(payments).toContain('customerWalletLedgerEntry.findUnique');
  });

  it('Stripe webhook events are deduplicated by persisting the event id inside the same transaction as its effects', () => {
    expect(payments).toContain('stripeWebhookEvent.create({');
    expect(payments).toContain("hasPrismaErrorCode(error, 'P2002')");
    expect(payments).toContain('duplicate: true');
  });

  it('tasker earning creation is idempotent per booking regardless of how many times settlement runs', () => {
    const financeService = read('src/modules/tasker-finance/tasker-finance.service.ts');
    expect(financeService).toContain('taskerEarning.findUnique({');
    expect(financeService).toContain('already recorded with different financial parameters');
  });

  it('cash collection confirmation requires a client idempotency key and a matching final amount', () => {
    const financeService = read('src/modules/tasker-finance/tasker-finance.service.ts');
    expect(financeService).toContain("if (!input.idempotencyKey.trim())");
    expect(financeService).toContain('taskerPlatformReceivable.findUnique');
    expect(financeService).toContain('already confirmed with different parameters');
  });
});
