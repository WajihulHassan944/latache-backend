import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { TaskerTasksService } from '../src/modules/tasker-dashboard/services/tasker-tasks.service';

type Stub = Record<string, unknown>;

const bookingRow = (overrides: Stub = {}) => ({
  id: 7,
  customerId: 20,
  taskerId: 31,
  availabilityId: 99,
  status: 'awaiting_payment',
  paymentSource: 'wallet',
  capturedAt: null,
  bookingDate: new Date('2099-01-10T00:00:00.000Z'),
  startTime: '10:00',
  paymentDueAt: new Date(Date.now() - 60_000),
  ...overrides,
});

const buildBookings = (row: Stub | null, settlement: 'captured' | 'in_flight' | 'none' = 'none') => {
  const transaction = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    booking: { findUnique: jest.fn().mockResolvedValue(row), update: jest.fn() },
    userAvailability: { updateMany: jest.fn() },
  };
  const service = Object.create(BookingsService.prototype) as BookingsService;
  const notifications = { create: jest.fn() };
  const payments = { settleAcceptancePaymentBeforeExpiry: jest.fn().mockResolvedValue(settlement) };
  Object.assign(service, {
    logger: { error: jest.fn() },
    config: { get: (_key: string, fallback: unknown) => fallback },
    prisma: {
      $transaction: (fn: (tx: typeof transaction) => unknown) => fn(transaction),
      booking: {
        findMany: jest.fn().mockResolvedValue(row ? [{ id: row.id, paymentSource: row.paymentSource }] : []),
      },
    },
    payments,
    notifications,
    referrals: { releaseCustomerDiscountReservation: jest.fn() },
    audit: { record: jest.fn() },
    enqueueBookingUpdate: jest.fn(),
  });
  return { service, transaction, notifications, payments };
};

describe('awaiting_payment expiry sweep', () => {
  it('cancels an unpaid booking past its deadline, frees the slot, and tells both sides', async () => {
    const { service, transaction, notifications } = buildBookings(bookingRow());
    await expect(service.expireDueAwaitingPaymentBookings()).resolves.toMatchObject({ expired: 1 });
    expect(transaction.userAvailability.updateMany).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { isBooked: false },
    });
    expect(transaction.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'cancelled', cancelledByRole: 'system' }) }),
    );
    const recipients = notifications.create.mock.calls.map((call) => call[0]);
    expect(recipients).toEqual([20, 31]);
    expect(notifications.create.mock.calls.every((call) => call[1].type === 'booking_payment_expired')).toBe(true);
  });

  it('leaves a booking alone once it was paid in the meantime', async () => {
    const { service, transaction } = buildBookings(bookingRow({ status: 'confirmed', capturedAt: new Date() }));
    await expect(service.expireDueAwaitingPaymentBookings()).resolves.toMatchObject({ expired: 0 });
    expect(transaction.booking.update).not.toHaveBeenCalled();
  });

  it('does not cancel before the deadline', async () => {
    const { service, transaction } = buildBookings(bookingRow({ paymentDueAt: new Date(Date.now() + 60_000) }));
    await service.expireDueAwaitingPaymentBookings();
    expect(transaction.booking.update).not.toHaveBeenCalled();
  });

  it('reconciles a Stripe payment that actually succeeded instead of cancelling', async () => {
    const { service, transaction, payments } = buildBookings(bookingRow({ paymentSource: 'stripe' }), 'captured');
    await expect(service.expireDueAwaitingPaymentBookings()).resolves.toMatchObject({ reconciled: 1, expired: 0 });
    expect(payments.settleAcceptancePaymentBeforeExpiry).toHaveBeenCalledWith(7);
    expect(transaction.booking.update).not.toHaveBeenCalled();
  });

  it('waits while a Stripe payment is still processing', async () => {
    const { service, transaction } = buildBookings(bookingRow({ paymentSource: 'stripe' }), 'in_flight');
    await expect(service.expireDueAwaitingPaymentBookings()).resolves.toMatchObject({ deferred: 1, expired: 0 });
    expect(transaction.booking.update).not.toHaveBeenCalled();
  });
});

describe('payment deadline set at Tasker acceptance', () => {
  const deadline = (minutes: number, bookingDate: Date, startTime: string) => {
    const service = Object.create(TaskerTasksService.prototype) as TaskerTasksService;
    Object.assign(service, {
      platformSettings: {
        bookingAwaitingPaymentPolicy: jest.fn().mockResolvedValue({ awaitingPaymentMinutes: minutes }),
      },
    });
    return (service as unknown as {
      paymentDeadline: (d: Date, t: string, tx: unknown) => Promise<Date>;
    }).paymentDeadline(bookingDate, startTime, {});
  };

  it('uses the configured window for a booking far in the future', async () => {
    const before = Date.now();
    const due = await deadline(60, new Date('2099-01-10T00:00:00.000Z'), '10:00');
    expect(due.getTime() - before).toBeGreaterThanOrEqual(59 * 60_000);
    expect(due.getTime() - before).toBeLessThanOrEqual(61 * 60_000);
  });

  it('never runs past the booking start, but always leaves at least 5 minutes', async () => {
    const soon = new Date(Date.now() + 20 * 60_000);
    const day = new Date(Date.UTC(soon.getUTCFullYear(), soon.getUTCMonth(), soon.getUTCDate()));
    const start = `${String(soon.getUTCHours()).padStart(2, '0')}:${String(soon.getUTCMinutes()).padStart(2, '0')}`;
    const due = await deadline(60, day, start);
    expect(due.getTime()).toBeLessThanOrEqual(soon.getTime());
    const floor = await deadline(60, new Date('2000-01-01T00:00:00.000Z'), '10:00');
    expect(floor.getTime() - Date.now()).toBeGreaterThan(4 * 60_000);
  });
});

describe('tasker is told when the customer pays', () => {
  it('notifies both participants from the single capture choke point', () => {
    const payments = readFileSync(join(process.cwd(), 'src/modules/payments/payments.service.ts'), 'utf8');
    const capture = payments.slice(payments.indexOf('private async markAcceptanceCaptured'));
    const body = capture.slice(0, capture.indexOf('\n  }\n'));
    expect(body).toContain("notifications.create(booking.customerId, { category: 'payments', type: 'booking_payment_captured'");
    const taskerCall = body.slice(body.indexOf('notifications.create(booking.taskerId'));
    expect(taskerCall).toContain("type: 'booking_payment_captured'");
    expect(taskerCall).toContain("entityType: 'booking'");
    expect(taskerCall).toContain('audienceRole: UserRole.Tasker');
  });

  it('handles the acceptance-capture PaymentIntent webhook (3DS completed outside the app)', () => {
    const payments = readFileSync(join(process.cwd(), 'src/modules/payments/payments.service.ts'), 'utf8');
    expect(payments).toContain('kind === ACCEPTANCE_CAPTURE_INTENT_KIND');
    expect(payments).toContain('private async handleAcceptanceIntent(');
  });
});
