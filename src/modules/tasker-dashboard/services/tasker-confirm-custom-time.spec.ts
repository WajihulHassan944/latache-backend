import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../database/prisma.service';
import { TaskerTasksService } from './tasker-tasks.service';

const TASKER_ID = 31;

const setup = (opts: { isCustomTime: boolean; sameDay: Array<{ id: number; startTime: string; endTime: string }> }) => {
  const booking = {
    id: 7,
    taskerId: TASKER_ID,
    customerId: 20,
    status: 'pending',
    isCustomTime: opts.isCustomTime,
    bookingDate: new Date('2099-01-10T00:00:00.000Z'),
    startTime: '19:30',
    endTime: '21:30',
    paymentSource: null,
    capturedAt: null,
    capturedAmount: null,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]),
    booking: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(booking),
      findMany: jest.fn().mockResolvedValue(opts.sameDay),
      update: jest.fn().mockResolvedValue({ ...booking, status: 'awaiting_payment' }),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const service = new TaskerTasksService(
    prisma,
    { create: jest.fn() } as never,
    { enqueueBooking: jest.fn() } as never,
    { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService,
    {} as never,
    { bookingAwaitingPaymentPolicy: jest.fn().mockResolvedValue({ awaitingPaymentMinutes: 60 }) } as never,
    { record: jest.fn() } as never,
    {} as never,
    { refreshPaymentEstimate: jest.fn() } as never,
    {} as never,
  );
  jest
    .spyOn(service as unknown as { serialize: () => unknown }, 'serialize')
    .mockReturnValue({ id: '7' });
  return { service, tx };
};

describe('TaskerTasksService.confirm custom-time conflict', () => {
  it('409s with CUSTOM_TIME_SLOT_CONFLICT when another booking overlaps', async () => {
    const { service, tx } = setup({
      isCustomTime: true,
      sameDay: [{ id: 9, startTime: '20:00', endTime: '22:00' }],
    });
    const error = await service.confirm(TASKER_ID, 7).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'CUSTOM_TIME_SLOT_CONFLICT',
      conflictingBookingId: '9',
    });
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(tx.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 7 }, status: { not: 'cancelled' } }),
      }),
    );
  });

  it('accepts a custom-time booking when nothing overlaps', async () => {
    const { service, tx } = setup({
      isCustomTime: true,
      sameDay: [{ id: 9, startTime: '17:00', endTime: '19:30' }],
    });
    await service.confirm(TASKER_ID, 7);
    expect(tx.booking.update).toHaveBeenCalled();
  });

  it('skips the check for a listed-slot booking (claimSlot already protected it)', async () => {
    const { service, tx } = setup({ isCustomTime: false, sameDay: [] });
    await service.confirm(TASKER_ID, 7);
    expect(tx.booking.findMany).not.toHaveBeenCalled();
    expect(tx.booking.update).toHaveBeenCalled();
  });
});
