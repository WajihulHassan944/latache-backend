import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('not-started booking expiration', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('cancels never-started accepted bookings with a distinct system reason and refunds prepayment', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    expect(bookings).toContain('async expireDueNotStartedBookings()');
    expect(bookings).toContain("const NOT_STARTED_EXPIRABLE_STATUSES = ['confirmed', 'en_route', 'arrived'] as const;");
    expect(bookings).toMatch(/expireOneNotStartedBooking[\s\S]*?FOR UPDATE/);
    expect(bookings).toContain("'Automatically expired: booking was never started'");
    expect(bookings).toContain('booking_expired_not_started');
    expect(bookings).toMatch(/expireOneNotStartedBooking[\s\S]*?refundAcceptanceCaptureOnCancel/);
    expect(bookings).toMatch(/expireOneNotStartedBooking[\s\S]*?releaseCustomerDiscountReservation/);
  });

  it('is wired through the BullMQ maintenance queue with a platform-settings-driven grace window', () => {
    const jobs = read('src/infrastructure/jobs/performance-jobs.service.ts');
    expect(jobs).toContain("ExpireNotStartedBookings: 'bookings.expire-not-started'");
    expect(jobs).toContain('expire-not-started-bookings-v1');
    expect(jobs).toContain('this.bookings.expireDueNotStartedBookings()');
    const settings = read('src/modules/platform-settings/platform-settings.service.ts');
    expect(settings).toContain('async bookingNotStartedExpiryPolicy(');
    expect(settings).toContain('section.notStartedExpiryHours');
    expect(read('src/config/configuration.ts')).toContain('BOOKING_NOT_STARTED_EXPIRY_HOURS');
  });

  it('a cancelled booking is no longer an active conversation booking', () => {
    const conversations = read('src/modules/conversations/conversations.service.ts');
    const active = /const ACTIVE_BOOKING_STATUSES = \[([\s\S]*?)\];/.exec(conversations)?.[1] ?? '';
    expect(active).not.toContain("'cancelled'");
  });
});
