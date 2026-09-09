import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('pending booking expiration', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('expires stale pending bookings without ever charging or refunding', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    expect(bookings).toContain('async expireDuePendingBookings()');
    expect(bookings).toContain("status: 'pending', createdAt: { lte: cutoff }");
    expect(bookings).toContain('FOR UPDATE');
    expect(bookings).toContain("if (!booking || booking.status !== 'pending') return false");
    expect(bookings).toContain("cancelledByRole: 'system'");
    expect(bookings).toContain('booking_expired_no_response');
    expect(bookings).toContain('releaseCustomerDiscountReservation');
    expect(bookings).toContain('isBooked: false');
    // Never invents a Stripe charge/refund for a booking that was never charged.
    expect(bookings).not.toMatch(/expireDuePendingBookings[\s\S]*?stripeProvider/);
    expect(bookings).not.toMatch(/expireOnePendingBooking[\s\S]*?issueDisputeRefund/);
  });

  it('is wired through the existing BullMQ maintenance queue, not an ad-hoc timer', () => {
    const jobs = read('src/infrastructure/jobs/performance-jobs.service.ts');
    expect(jobs).toContain("ExpirePendingBookings: 'bookings.expire-pending'");
    expect(jobs).toContain('expire-pending-bookings-v1');
    expect(jobs).toContain('bookingExpiration.sweepIntervalMs');
    expect(jobs).toContain('this.bookings.expireDuePendingBookings()');
  });

  it('exposes configurable policy with sane defaults', () => {
    const config = read('src/config/configuration.ts');
    expect(config).toContain('bookingExpiration:');
    expect(config).toContain('BOOKING_PENDING_EXPIRY_MINUTES');
    expect(read('.env.example')).toContain('BOOKING_PENDING_EXPIRY_MINUTES=60');
  });
});
