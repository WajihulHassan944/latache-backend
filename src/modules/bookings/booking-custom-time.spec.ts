import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../database/prisma.service';
import { BookingsService } from './bookings.service';

type SlotContext = { slot: { id: number | null; startTime: string; endTime: string }; isCustomTime: boolean };
type LoadQuoteContext = (
  taskerId: number,
  serviceSlug: string,
  serviceOptionId: number | undefined,
  date: string,
  time: string,
  transaction?: unknown,
  customTime?: unknown,
  allowCustomTime?: boolean,
) => Promise<SlotContext>;

const setup = (activeBookings: Array<{ startTime: string; endTime: string }> = []) => {
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 31 }) },
    service: { findFirst: jest.fn().mockResolvedValue({ id: 8, slug: 'cleaning' }) },
    serviceOption: { findFirst: jest.fn() },
    userService: { findUnique: jest.fn().mockResolvedValue({ hourlyRate: 20 }) },
    userAvailability: {
      findMany: jest.fn().mockResolvedValue([{ id: 5, startTime: '09:00', endTime: '11:00' }]),
    },
    booking: { findMany: jest.fn().mockResolvedValue(activeBookings) },
  } as unknown as PrismaService;
  const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;
  const service = new BookingsService(
    prisma, {} as never, {} as never, {} as never, config, {} as never, {} as never,
    {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  const load = (time: string, allowCustomTime?: boolean) =>
    (service as unknown as { loadQuoteContext: LoadQuoteContext }).loadQuoteContext(
      31, 'cleaning', undefined, '2099-01-10', time, undefined, undefined, allowCustomTime,
    );
  return { load };
};

describe('BookingsService custom-time inference', () => {
  it('books the listed slot when the time matches an open slot', async () => {
    const context = await setup().load('09:00');
    expect(context.isCustomTime).toBe(false);
    expect(context.slot).toMatchObject({ id: 5, startTime: '09:00', endTime: '11:00' });
  });

  it('turns a time outside listed availability into a custom-time booking', async () => {
    const context = await setup().load('19:30');
    expect(context.isCustomTime).toBe(true);
    // Dedicated slot spans the minimum billable time (120 min default).
    expect(context.slot).toEqual({ id: null, startTime: '19:30', endTime: '21:30' });
  });

  it('customTime=false keeps the strict open-slot requirement', async () => {
    await expect(setup().load('19:30', false)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a custom time that overlaps an active booking', async () => {
    const { load } = setup([{ startTime: '20:00', endTime: '22:00' }]);
    await expect(load('19:30')).rejects.toBeInstanceOf(ConflictException);
  });
});
