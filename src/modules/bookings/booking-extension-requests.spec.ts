import { ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { UserRole } from '../../common/enums/user-role.enum';
import type { PrismaService } from '../../database/prisma.service';
import type { User } from '../../generated/prisma/client';
import type { AdminAuditService } from '../admin-audit/admin-audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import { BookingsService } from './bookings.service';

const CUSTOMER_ID = 20;
const TASKER_ID = 31;

const pendingRequest = {
  id: 'ext_1',
  bookingId: 7,
  requestedById: TASKER_ID,
  requestedByRole: 'tasker',
  minutes: 30,
  note: null,
  status: 'pending',
  respondedAt: null,
  createdAt: new Date('2026-09-28T10:00:00.000Z'),
  updatedAt: new Date('2026-09-28T10:00:00.000Z'),
};

const setup = (opts: { status?: string; existingPending?: typeof pendingRequest | null } = {}) => {
  const booking = {
    id: 7,
    customerId: CUSTOMER_ID,
    taskerId: TASKER_ID,
    status: opts.status ?? 'in_progress',
    estimatedDurationMinutes: 120,
    extensionMinutes: 0,
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    booking: {
      findUnique: jest.fn().mockResolvedValue(booking),
      findFirst: jest.fn().mockResolvedValue(booking),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ ...booking, extensionMinutes: booking.extensionMinutes + (data.extensionMinutes?.increment ?? 0) }),
      ),
    },
    bookingExtensionRequest: {
      findFirst: jest.fn().mockResolvedValue(opts.existingPending ?? null),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...pendingRequest, ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
    booking: { findUniqueOrThrow: jest.fn().mockResolvedValue(booking) },
  } as unknown as PrismaService;
  const notifications = { create: jest.fn() } as unknown as NotificationsService;
  const realtime = { enqueueBooking: jest.fn() } as unknown as RealtimeOutboxService;
  const audit = { record: jest.fn() } as unknown as AdminAuditService;
  const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;
  const service = new BookingsService(
    prisma, {} as never, {} as never, notifications, config, {} as never, realtime,
    {} as never, audit, {} as never, {} as never, {} as never, {} as never, {} as never,
  );
  jest
    .spyOn(service as unknown as { serialize: () => unknown }, 'serialize')
    .mockReturnValue({ id: '7' });
  return { service, tx, notifications };
};

const user = (id: number, role: UserRole) => ({ id, role }) as unknown as User;

describe('BookingsService extra task time', () => {
  it('a Tasker request adds no minutes and notifies the customer', async () => {
    const { service, tx, notifications } = setup();
    const result = await service.extend(user(TASKER_ID, UserRole.Tasker), 7, { minutes: 30 });

    expect(result.outcome).toBe('pending_customer_approval');
    expect(result.extensionMinutes).toBe(0);
    expect(result.extensionRequest).toMatchObject({ minutes: 30, status: 'pending' });
    expect(tx.booking.update).not.toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({ type: 'task_time_extension_requested' }),
      tx,
    );
  });

  it('refuses a second Tasker request while one is pending', async () => {
    const { service } = setup({ existingPending: pendingRequest });
    await expect(
      service.extend(user(TASKER_ID, UserRole.Tasker), 7, { minutes: 15 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('a customer extension is applied immediately', async () => {
    const { service, tx } = setup();
    const result = await service.extend(user(CUSTOMER_ID, UserRole.Customer), 7, { minutes: 30 });

    expect(result.outcome).toBe('added');
    expect(result.extensionMinutes).toBe(30);
    expect(tx.bookingExtensionRequest.create).not.toHaveBeenCalled();
  });

  it('customer approval adds the requested minutes', async () => {
    const { service, tx } = setup({ existingPending: pendingRequest });
    await service.respondExtensionRequest(CUSTOMER_ID, 7, 'ext_1', { approve: true });

    expect(tx.bookingExtensionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'approved' }) }),
    );
    expect(tx.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { extensionMinutes: { increment: 30 } } }),
    );
  });

  it('customer decline adds nothing', async () => {
    const { service, tx } = setup({ existingPending: pendingRequest });
    await service.respondExtensionRequest(CUSTOMER_ID, 7, 'ext_1', { approve: false });

    expect(tx.bookingExtensionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'rejected' }) }),
    );
    expect(tx.booking.update).not.toHaveBeenCalled();
  });

  it('a request left over after the task ended expires instead of applying', async () => {
    const { service, tx } = setup({ status: 'completed', existingPending: pendingRequest });
    await expect(
      service.respondExtensionRequest(CUSTOMER_ID, 7, 'ext_1', { approve: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.bookingExtensionRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'expired' }) }),
    );
    expect(tx.booking.update).not.toHaveBeenCalled();
  });
});
