import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('cancellation attribution on GET /bookings responses', () => {
  const root = process.cwd();
  const read = (path: string): string => readFileSync(join(root, path), 'utf8');

  it('serializes cancelledByRole/cancellationReason/cancelledAt, null unless status is cancelled', () => {
    const bookings = read('src/modules/bookings/bookings.service.ts');
    const start = bookings.indexOf('private serialize(booking: UnifiedBookingWithRelations');
    const end = bookings.indexOf('private assertDashboardRole(');
    const body = bookings.slice(start, end);
    expect(body).toContain(
      "cancelledByRole: booking.status === 'cancelled' ? booking.cancelledByRole : null",
    );
    expect(body).toContain(
      "cancellationReason: booking.status === 'cancelled' ? booking.cancellationReason : null",
    );
    expect(body).toContain("booking.status === 'cancelled'");
    expect(body).toContain('booking.cancelledAt?.toISOString() ?? null');
  });

  it('pending-booking auto-expiry stays a 24-hour-minimum default, not the old 60-minute one', () => {
    const config = read('src/config/configuration.ts');
    expect(config).toContain(
      "pendingMinutes: asPositiveInteger(process.env.BOOKING_PENDING_EXPIRY_MINUTES, 1_440)",
    );
    expect(read('.env.example')).toContain('BOOKING_PENDING_EXPIRY_MINUTES=1440');
  });
});
