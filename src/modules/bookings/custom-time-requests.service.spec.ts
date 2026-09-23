import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../database/prisma.service';
import type { CustomTimeRequest } from '../../generated/prisma/client';
import type { NotificationsService } from '../notifications/notifications.service';
import { CustomTimeRequestsService } from './custom-time-requests.service';

const baseRequest = (overrides: Partial<CustomTimeRequest> = {}): CustomTimeRequest => ({
  id: 'ctr_1',
  customerId: 20,
  taskerId: 31,
  serviceId: 8,
  serviceSlug: 'cleaning',
  requestedDate: new Date('2099-01-10T00:00:00.000Z'),
  requestedTime: '19:30',
  status: 'accepted',
  expiresAt: new Date(Date.now() + 10 * 60_000),
  respondedAt: new Date(),
  fulfilledAt: null,
  bookingId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const serviceWith = (row: CustomTimeRequest | null) => {
  const prisma = {
    customTimeRequest: { findUnique: jest.fn().mockResolvedValue(row) },
  } as unknown as PrismaService;
  const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;
  return new CustomTimeRequestsService(prisma, {} as NotificationsService, config);
};

const claim = {
  requestId: 'ctr_1',
  customerId: 20,
  taskerId: 31,
  serviceSlug: 'cleaning',
  date: '2099-01-10',
  time: '19:30',
};

describe('CustomTimeRequestsService.assertUsableForBooking', () => {
  it('accepts an accepted, unexpired request matching the booking exactly', async () => {
    await expect(serviceWith(baseRequest()).assertUsableForBooking(claim)).resolves.toMatchObject({
      id: 'ctr_1',
    });
  });

  it("hides another customer's request as not found", async () => {
    await expect(
      serviceWith(baseRequest({ customerId: 99 })).assertUsableForBooking(claim),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['tasker', { taskerId: 32 }],
    ['service', { serviceSlug: 'plumbing' }],
    ['date', { date: '2099-01-11' }],
    ['time', { time: '19:00' }],
  ])('rejects a %s mismatch', async (_label, change) => {
    await expect(
      serviceWith(baseRequest()).assertUsableForBooking({ ...claim, ...change }),
    ).rejects.toMatchObject({ response: { code: 'CUSTOM_TIME_REQUEST_MISMATCH' } });
  });

  it.each([
    ['pending', {}, 'CUSTOM_TIME_REQUEST_NOT_ACCEPTED'],
    ['rejected', {}, 'CUSTOM_TIME_REQUEST_NOT_ACCEPTED'],
    ['fulfilled', {}, 'CUSTOM_TIME_REQUEST_FULFILLED'],
    ['expired', {}, 'CUSTOM_TIME_REQUEST_EXPIRED'],
    ['accepted', { expiresAt: new Date(Date.now() - 1000) }, 'CUSTOM_TIME_REQUEST_EXPIRED'],
  ])('rejects a %s request', async (status, extra, code) => {
    await expect(
      serviceWith(baseRequest({ status, ...extra })).assertUsableForBooking(claim),
    ).rejects.toMatchObject({ response: { code } });
  });

  it('treats 12-hour and 24-hour spellings of the same time as a match', async () => {
    await expect(
      serviceWith(baseRequest()).assertUsableForBooking({ ...claim, time: '7:30 PM' }),
    ).resolves.toBeDefined();
  });
});

describe('CustomTimeRequestsService.view', () => {
  it('reports a lapsed pending request as expired before the sweep runs', () => {
    const service = serviceWith(null);
    const view = service.view(
      baseRequest({ status: 'pending', expiresAt: new Date(Date.now() - 1000) }),
    );
    expect(view.status).toBe('expired');
    expect(view.requestedDate).toBe('2099-01-10');
    expect(view.taskerId).toBe('31');
  });
});

describe('CustomTimeRequestsService.markFulfilled', () => {
  it('refuses when the request was consumed concurrently', async () => {
    const service = serviceWith(null);
    const transaction = {
      customTimeRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    await expect(
      service.markFulfilled('ctr_1', 5, transaction as never),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
