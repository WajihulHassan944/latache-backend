import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('Tasker earning clearance and cash accounting architecture', () => {
  const schema = read('prisma/schema.prisma');
  const finance = read('src/modules/tasker-finance/tasker-finance.service.ts');
  const worker = read('src/modules/tasker-finance/tasker-earnings.worker.ts');
  const payments = read('src/modules/payments/payments.service.ts');
  const bookings = read('src/modules/bookings/bookings.service.ts');

  it('keeps online earnings as per-booking pending liabilities with immutable pricing snapshots', () => {
    expect(schema).toContain('model TaskerEarning {');
    expect(schema).toMatch(/model TaskerEarning \{[\s\S]*bookingId\s+Int\s+@unique/);
    expect(schema).toContain('platformCommissionAmount');
    expect(schema).toContain('taskerNetAmount');
    expect(schema).toContain('settledAt');
    expect(schema).toContain('clearsAt');
    expect(finance).toContain('status: TASKER_EARNING_STATUS.Pending');
    expect(finance).toContain('pendingBalance: { increment:');
    expect(finance).not.toContain('Task completion never creates fake earnings');
  });

  it('releases only mature, unblocked records and serializes duplicate workers on the earning row', () => {
    expect(worker).toContain("status: { in: ['pending', 'partially_reversed'] }");
    expect(worker).toContain('clearsAt: { lte: new Date() }');
    expect(finance).toContain('SELECT "id" FROM "TaskerEarnings"');
    expect(finance).toContain('FOR UPDATE');
    expect(finance).toContain('earning.isBlocked');
    expect(finance).toContain('idempotencyKey: `earning:${earning.id}:release`');
    expect(finance).toContain('activeDisputes > 0');
  });

  it('reverses pending funds before using the available-balance clawback', () => {
    expect(finance).toContain('const pendingReversal = Math.min(clawback, unreleased)');
    expect(finance).toContain('const availableClawback = money(clawback - pendingReversal)');
    expect(finance).toContain('pendingBalance: { decrement:');
    expect(finance).toContain('availableBalance: { decrement:');
    expect(payments).toContain('applyRefundAdjustment');
  });

  it('keeps cash outside the Tasker wallet and records an auditable platform receivable', () => {
    expect(schema).toContain('model TaskerPlatformAccount {');
    expect(schema).toContain('model TaskerPlatformReceivable {');
    expect(schema).toContain('model TaskerPlatformLedgerEntry {');
    const cashStart = finance.indexOf('async confirmCashCollection');
    const cashEnd = finance.indexOf('async assertCashBookingAllowed');
    const cashFlow = finance.slice(cashStart, cashEnd);
    expect(cashFlow).toContain('taskerPlatformReceivable.create');
    expect(cashFlow).toContain('taskerPlatformAccount.update');
    expect(cashFlow).toContain("provider: 'cash_direct'");
    expect(cashFlow).not.toContain('taskerWallet.update');
    expect(cashFlow).not.toContain('availableBalance');
  });

  it('offsets oldest cash debt transactionally before releasing available online earnings', () => {
    expect(finance).toContain(
      'const debtOffset = Math.min(releasable, money(account.outstandingPayable))',
    );
    expect(finance).toContain("orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }]");
    expect(finance).toContain('kind: PLATFORM_LEDGER_KIND.EarningDebtOffset');
    expect(finance).toContain('outstandingPayable: { decrement:');
    expect(finance).toContain('availableBalance: { increment:');
  });

  it('enforces configurable debt thresholds at cash booking creation', () => {
    expect(bookings).toContain('assertCashBookingAllowed');
    expect(finance).toContain('maximumOutstandingPlatformDebt');
    expect(finance).toContain('blockCashBookingsAtDebtLimit');
    expect(finance).toContain(
      "type: shouldRestrict ? 'cash_bookings_restricted' : 'cash_bookings_unrestricted'",
    );
  });

  it('keeps Stripe webhook and cash confirmation replay-safe', () => {
    expect(schema).toContain('model StripeWebhookEvent {');
    expect(schema).toContain('confirmationIdempotencyKey String');
    expect(schema).toContain('@unique(map: "TaskerPlatformReceivables_confirmation_key")');
    expect(payments).toContain('stripeWebhookEvent.create');
    expect(payments).toContain('taskerEarning.findUnique');
    expect(finance).toContain('taskerPlatformReceivable.findUnique');
  });

  it('exposes one source of truth to both Tasker wallet and Admin Finance', () => {
    const taskerController = read(
      'src/modules/tasker-dashboard/controllers/tasker-wallet.controller.ts',
    );
    const adminController = read(
      'src/modules/admin-finance/controllers/admin-finance.controller.ts',
    );
    expect(taskerController).toContain("@Get('earnings')");
    expect(taskerController).toContain("@Get('platform-payables')");
    expect(adminController).toContain(
      'view=overview|transactions|refunds|payouts|revenue|earnings|cash_receivables',
    );
    expect(adminController).toContain("@Post('earnings/:id/actions')");
  });
});
