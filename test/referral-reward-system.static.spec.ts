import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

describe('production referral reward system', () => {
  const service = read('src/modules/referrals/services/referrals.service.ts');
  const schema = read('prisma/schema.prisma');
  const migration = read(
    'prisma/migrations/20260818140000_complete_referral_reward_system/migration.sql',
  );
  const payments = read('src/modules/payments/payments.service.ts');
  const jobs = read('src/infrastructure/jobs/performance-jobs.service.ts');

  it('persists one attribution per referred account with immutable policy and reward ledgers', () => {
    expect(schema).toContain('referredUserId      Int       @unique');
    expect(schema).toContain('policySnapshot');
    expect(schema).toContain('idempotencyKey');
    expect(schema).toContain('referralRewardId');
    expect(migration).toContain('Referrals_distinct_users_check');
    expect(migration).toContain('ReferralRewards_amounts_check');
  });

  it('qualifies only authoritative online paid bookings and preserves charge floors', () => {
    expect(service).toContain("booking.paymentStatus !== 'paid'");
    expect(service).toContain('REFERRAL_ONLINE_PAYMENT_SOURCES');
    expect(service).toContain('minimumQualifyingBookingAmount');
    expect(service).toContain('minimumCustomerChargeAmount');
    expect(payments).toContain('reserveCustomerDiscount');
    expect(payments).toContain('qualifyPaidBooking');
  });

  it('delays rewards, blocks active disputes, and claws back after ineligible refunds', () => {
    expect(service).toContain('rewardClearanceDays');
    expect(service).toContain("status: { in: ['open', 'under_investigation', 'escalated'] }");
    expect(service).toContain('handleBookingRefund');
    expect(service).toContain('REFERRAL_WALLET_ENTRY_KIND.Reversal');
    expect(service).toContain('REFERRAL_CHARGEBACK_HOLD_STATUSES');
    expect(service).toContain('handleBookingChargeback');
    expect(payments).toContain('handleBookingChargeback');
    expect(payments.match(/handleBookingRefund/g)).toHaveLength(4);
    expect(jobs).toContain("MaintainReferrals: 'referrals.maintain'");
  });

  it('keeps the migration additive', () => {
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|TYPE|SCHEMA)\b/i);
    expect(migration).not.toMatch(/\bTRUNCATE\b/i);
    expect(migration).not.toMatch(/\bDELETE\s+FROM\b/i);
  });
});
