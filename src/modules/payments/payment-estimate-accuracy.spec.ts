import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PaymentsService } from './payments.service';
import type { DurationReviewQuote, PaymentEstimate } from './payments.types';

/** 10% platform fee, 5% tax exclusive, no surcharge: easy numbers to assert. */
const platformSettings = {
  calculatePricingCharges: jest.fn(async ({ serviceAmount }: { serviceAmount: number }) => ({
    serviceAmount,
    platformFeeAmount: Math.round(serviceAmount * 10) / 100,
    serviceSurchargeAmount: 0,
    taxAmount: Math.round(serviceAmount * 5) / 100,
    taxInclusive: false,
    commissionRatePercent: 0,
    taxRatePercent: 5,
  })),
};

const booking = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  status: 'in_progress',
  hourlyRate: new Prisma.Decimal(45),
  taskerId: 31,
  customerId: 3,
  serviceId: 8,
  bookingDate: new Date('2099-01-10T00:00:00.000Z'),
  createdAt: new Date('2099-01-01T00:00:00.000Z'),
  tipAmount: new Prisma.Decimal(0),
  donationAmount: new Prisma.Decimal(0),
  estimatedDurationMinutes: 120,
  extensionMinutes: 0,
  totalChargedAmount: null,
  paymentEstimate: null,
  durationReview: null,
  capturedAt: null,
  capturedAmount: null,
  paymentSource: 'cash',
  paymentCurrency: 'USD',
  paymentStatus: 'ready',
  workVerificationRequired: false,
  completionVerifiedAt: null,
  complaints: [],
  ...overrides,
});

const make = (row: Record<string, unknown> = booking()) => {
  const update = jest.fn().mockResolvedValue({});
  const prisma = {
    booking: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(row),
      findUnique: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([]),
      update,
    },
  } as unknown as PrismaService;
  const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;
  const realtime = { enqueueBooking: jest.fn() };
  const notifications = { create: jest.fn() };
  const service = new PaymentsService(
    prisma, {} as never, config, notifications as never, platformSettings as never,
    {} as never, {} as never, {} as never, realtime as never, {} as never,
  );
  return { service, prisma, update, realtime };
};

describe('Payment estimate accuracy', () => {
  it('prices booked + approved extra minutes: +30 min at $45/h adds $22.50 service', async () => {
    const { service } = make();
    const before = await service.bookingEstimate(booking());
    const after = await service.bookingEstimate(booking({ extensionMinutes: 30 }));
    expect(before.billableMinutes).toBe(120);
    expect(after.billableMinutes).toBe(150);
    expect(after.serviceAmount - before.serviceAmount).toBeCloseTo(22.5);
    // fee (10%) and tax (5%) follow the service amount into the total
    expect(after.total - before.total).toBeCloseTo(22.5 * 1.15);
  });

  it('never prices below the minimum billable time', async () => {
    const { service } = make();
    const estimate = await service.bookingEstimate(booking({ estimatedDurationMinutes: 2, extensionMinutes: 3 }));
    expect(estimate.billableMinutes).toBe(120);
  });

  it('refresh stores a new estimate for an uncharged booking', async () => {
    const { service, update } = make(booking({ extensionMinutes: 30 }));
    const estimate = (await service.refreshPaymentEstimate(7)) as PaymentEstimate;
    expect(estimate.billableMinutes).toBe(150);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { paymentEstimate: expect.objectContaining({ total: estimate.total }) } }));
  });

  it('refresh never re-estimates a booking that already has its final charge', async () => {
    const stored = { total: 103.5 };
    const { service, update } = make(booking({ totalChargedAmount: new Prisma.Decimal(103.5), paymentEstimate: stored, extensionMinutes: 60 }));
    await expect(service.refreshPaymentEstimate(7)).resolves.toBe(stored);
    expect(update).not.toHaveBeenCalled();
  });

  it('backfill covers active and finished bookings that have no final charge', async () => {
    const { service, prisma } = make();
    await service.backfillPaymentEstimates();
    const where = (prisma.booking.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status.in).toEqual(expect.arrayContaining(['pending', 'awaiting_payment', 'confirmed', 'in_progress', 'awaiting_customer_approval', 'completed']));
    expect(where.totalChargedAmount).toBeNull();
  });
});

describe('Overtime approval figures', () => {
  // 150 min authorized, 180 min worked (timer), cash booking.
  const workSession = {
    startedAt: new Date('2099-01-10T10:00:00.000Z'),
    stoppedAt: new Date('2099-01-10T13:00:00.000Z'),
    accumulatedPausedSecs: 0,
  };

  it('holds payment and returns structured current / proposed / additional figures', async () => {
    const row = booking({ status: 'completed', extensionMinutes: 30, workSession });
    const { service, update, realtime } = make(row);
    const result = await service.finalizeCompletedBooking(7);

    expect(result.status).toBe('review_required_duration_exceeded');
    const quote = result.durationReview as DurationReviewQuote;
    expect(quote).toMatchObject({ actualMinutes: 180, authorizedMinutes: 150, additionalMinutes: 30, currency: 'USD', alreadyPaid: 0 });
    expect(quote.current.billableMinutes).toBe(150);
    expect(quote.proposed.billableMinutes).toBe(180);
    expect(quote.proposed.serviceAmount - quote.current.serviceAmount).toBeCloseTo(22.5);
    expect(quote.additionalAmount).toBeCloseTo(quote.proposed.total - quote.current.total);
    expect(quote.remainingAmount).toBe(quote.proposedTotal);
    // stored for the booking/payment views; failureReason stays text
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ durationReview: quote, paymentFailureReason: expect.stringContaining('180 minutes') }),
    }));
    expect(realtime.enqueueBooking).toHaveBeenCalled();
  });

  it('approval charges exactly the approved figures, even if pricing settings changed meanwhile', async () => {
    const quote: DurationReviewQuote = {
      actualMinutes: 180, authorizedMinutes: 150, additionalMinutes: 30,
      current: { billableMinutes: 150, serviceAmount: 112.5, platformFeeAmount: 11.25, serviceSurchargeAmount: 0, taxAmount: 5.63, taxInclusive: false, tipAmount: 0, donationAmount: 0, total: 129.38 },
      proposed: { billableMinutes: 180, serviceAmount: 135, platformFeeAmount: 13.5, serviceSurchargeAmount: 0, taxAmount: 6.75, taxInclusive: false, tipAmount: 0, donationAmount: 0, total: 155.25 },
      additionalAmount: 25.87, currentTotal: 129.38, proposedTotal: 155.25, alreadyPaid: 0, remainingAmount: 155.25,
      currency: 'USD', commissionRatePercent: 0, taxRatePercent: 5, calculatedAt: '2099-01-10T13:00:00.000Z',
    };
    // After approval: extension covers the worked time, status ready.
    const row = booking({ status: 'completed', extensionMinutes: 60, workSession, durationReview: quote });
    const { service, update } = make(row);
    platformSettings.calculatePricingCharges.mockClear();
    const result = await service.finalizeCompletedBooking(7);

    expect(result.status).toBe('cash_confirmation_required');
    expect(platformSettings.calculatePricingCharges).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ totalChargedAmount: '155.25' }),
    }));
  });
});
