import { PaymentsService } from '../src/modules/payments/payments.service';
import { CustomerDashboardService } from '../src/modules/dashboard/customer-dashboard.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, unknown>;

describe('acceptance prepayment equals the quoted estimate', () => {
  const build = (pricing: Row) => {
    const service = Object.create(PaymentsService.prototype) as PaymentsService;
    Object.assign(service, {
      minimumBillableMinutes: 120,
      platformSettings: { calculatePricingCharges: jest.fn().mockResolvedValue(pricing) },
    });
    return service as unknown as { acceptanceAmount: (b: Row) => Promise<number>; platformSettings: { calculatePricingCharges: jest.Mock } };
  };
  const booking = (overrides: Row = {}) => ({
    hourlyRate: '20.00', estimatedDurationMinutes: 240, taskerId: 31, serviceId: 8,
    bookingDate: new Date(), createdAt: new Date(), tipAmount: '5.00', donationAmount: '1.00', ...overrides,
  });

  it('includes platform fee, surcharge, tax, tip and donation like the quote', async () => {
    const service = build({ serviceAmount: 80, platformFeeAmount: 12, serviceSurchargeAmount: 2, taxAmount: 4, taxInclusive: false });
    await expect(service.acceptanceAmount(booking())).resolves.toBe(80 + 12 + 2 + 4 + 5 + 1);
  });

  it('never prepays less than the minimum billable time', async () => {
    const service = build({ serviceAmount: 40, platformFeeAmount: 0, serviceSurchargeAmount: 0, taxAmount: 0, taxInclusive: false });
    await service.acceptanceAmount(booking({ estimatedDurationMinutes: 30, tipAmount: '0', donationAmount: '0' }));
    // 30-minute slot is billed as the 120-minute minimum: 20/h x 2h
    expect(service.platformSettings.calculatePricingCharges.mock.calls[0][0].serviceAmount).toBe(40);
  });

  it('does not add inclusive tax on top', async () => {
    const service = build({ serviceAmount: 80, platformFeeAmount: 0, serviceSurchargeAmount: 0, taxAmount: 10, taxInclusive: true });
    await expect(service.acceptanceAmount(booking({ tipAmount: '0', donationAmount: '0' }))).resolves.toBe(80);
  });
});

describe('unused prepayment is returned to the customer', () => {
  const tx = () => ({
    $queryRaw: jest.fn().mockResolvedValue([]),
    paymentTransaction: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
    customerWallet: { update: jest.fn() },
    customerWalletLedgerEntry: { create: jest.fn() },
  });
  const service = () => {
    const s = Object.create(PaymentsService.prototype) as PaymentsService;
    Object.assign(s, { notifications: { create: jest.fn() }, ensureCustomerWallet: jest.fn() });
    return s as unknown as { refundUnusedPrepayment: (t: unknown, b: Row, a: number) => Promise<string> };
  };

  it('wallet: credits the unused amount back immediately', async () => {
    const t = tx();
    await expect(service().refundUnusedPrepayment(t, { id: 64, customerId: 20, paymentSource: 'wallet', paymentCurrency: 'USD' }, 26)).resolves.toBe('wallet_refunded');
    expect(t.customerWallet.update).toHaveBeenCalledWith({ where: { customerId: 20 }, data: { availableBalance: { increment: '26.00' } } });
    expect(t.paymentTransaction.create.mock.calls[0][0].data).toMatchObject({ kind: 'refund', status: 'succeeded', idempotencyKey: 'acceptance-underuse-refund:64' });
  });

  it('card: records a pending Stripe partial refund', async () => {
    const t = tx();
    await expect(service().refundUnusedPrepayment(t, { id: 70, customerId: 3, paymentSource: 'stripe', paymentCurrency: 'USD' }, 40)).resolves.toBe('card_refund_pending');
    expect(t.paymentTransaction.create.mock.calls[0][0].data).toMatchObject({ provider: 'stripe', status: 'pending', amount: '40.00' });
    expect(t.customerWallet.update).not.toHaveBeenCalled();
  });

  it('never refunds the same booking twice', async () => {
    const t = tx();
    t.paymentTransaction.findUnique.mockResolvedValue({ id: 'existing' });
    await expect(service().refundUnusedPrepayment(t, { id: 64, customerId: 20, paymentSource: 'wallet', paymentCurrency: 'USD' }, 26)).resolves.toBe('none');
    expect(t.customerWallet.update).not.toHaveBeenCalled();
  });
});

describe('final settlement reconciles money, not minutes', () => {
  const source = readFileSync(join(process.cwd(), 'src/modules/payments/payments.service.ts'), 'utf8');
  const finalize = source.slice(source.indexOf('async finalizeCompletedBooking('), source.indexOf('private async settleCapturedBooking('));
  it('charges or refunds the difference between the real total and the prepayment', () => {
    expect(finalize).toContain('roundMoney(totalBeforeDiscount - Number(booking.capturedAmount))');
    expect(finalize).toContain('this.settleCapturedBooking(bookingId, totalBeforeDiscount, roundMoney(-totalAmount))');
    expect(finalize).not.toContain('alreadyPaidMinutes');
  });
});

describe('payment method chosen after acceptance', () => {
  const bookings = readFileSync(join(process.cwd(), 'src/modules/bookings/bookings.service.ts'), 'utf8');
  const book = bookings.slice(bookings.indexOf('async book('), bookings.indexOf('async list('));
  it('creation stores null when no method is chosen and validates no payment details', () => {
    expect(book).toContain('const paymentSource = dto.paymentSource ?? null;');
    expect(book).not.toContain('PAYMENT_SOURCE.Stripe;');
    expect(book).not.toContain('assertCashBookingAllowed');
    expect(book).not.toContain('assertPaymentMethodOwnedByCustomer');
    expect(book).not.toContain('defaultPaymentMethod');
    expect(book).toContain('PAYMENT_STATUS.PaymentMethodRequired');
  });
});

describe('customer dashboard nextTask', () => {
  it('keeps an in-progress / awaiting-approval task as nextTask regardless of date', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      booking: { count: jest.fn().mockResolvedValue(0), findFirst, findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _sum: {} }) },
      user: { findFirst: jest.fn().mockResolvedValue({ id: 3, firstName: 'Sarah', profilePicture: null, accountStatus: 'active', customerProfile: { status: 'active' } }) },
      favoriteTasker: { count: jest.fn().mockResolvedValue(0) },
      customerWallet: { findUnique: jest.fn().mockResolvedValue(null) },
      $queryRaw: jest.fn().mockResolvedValue([]),
    };
    const service = Object.create(CustomerDashboardService.prototype) as CustomerDashboardService;
    Object.assign(service, {
      prisma,
      reviews: { averageGiven: jest.fn().mockResolvedValue(0) },
      platformSettings: { currencyContext: jest.fn().mockResolvedValue({ code: 'USD', symbol: '$', market: 'us' }) },
      settings: { currencyContext: jest.fn().mockResolvedValue({ code: 'USD', symbol: '$', market: 'us' }) },
    });
    try {
      await (service as unknown as { overview: (id: number) => Promise<unknown> }).overview(3);
    } catch {
      // Only the nextTask query shape matters here; unrelated mocked parts may throw later.
    }
    const where = findFirst.mock.calls[0][0].where;
    const ongoing = where.OR.find((c: Row) => !('bookingDate' in c));
    const upcoming = where.OR.find((c: Row) => 'bookingDate' in c);
    expect(ongoing.status.in).toEqual(expect.arrayContaining(['in_progress', 'awaiting_customer_approval', 'en_route', 'arrived']));
    expect(upcoming.status.in).toEqual(expect.arrayContaining(['pending', 'awaiting_payment', 'confirmed']));
  });
});
