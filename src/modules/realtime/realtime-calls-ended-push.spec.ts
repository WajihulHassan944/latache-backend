import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { UserRole } from '../../common/enums/user-role.enum';
import type { PrismaService } from '../../database/prisma.service';
import type { FcmService } from '../fcm/fcm.service';
import { RealtimeCallsService } from './realtime-calls.service';

const CUSTOMER_ID = 3;
const TASKER_ID = 31;

const person = (id: number) => ({ id, firstName: 'Test', lastName: String(id), profilePicture: null });

/** Customer (caller) rings the Tasker (callee) on booking 72. */
const ringingCall = (overrides: Record<string, unknown> = {}) => ({
  id: 'call_1',
  bookingId: 72,
  initiatorId: CUSTOMER_ID,
  recipientId: TASKER_ID,
  type: 'voice',
  status: 'ringing',
  clientRequestId: 'r1',
  expiresAt: new Date(Date.now() + 45_000),
  answeredAt: null,
  endedAt: null,
  endedById: null,
  endReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  initiator: person(CUSTOMER_ID),
  recipient: person(TASKER_ID),
  booking: { id: 72, status: 'confirmed', customerId: CUSTOMER_ID, taskerId: TASKER_ID, service: { id: 8, name: 'Cleaning' } },
  ...overrides,
});

const setup = (call = ringingCall()) => {
  let current = call;
  const tx = {
    conversationCall: {
      updateMany: jest.fn().mockImplementation(({ data }) => {
        current = { ...current, ...data };
        return Promise.resolve({ count: 1 });
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve(current)),
    },
    realtimeOutboxEvent: { create: jest.fn().mockResolvedValue({}) },
    taskNotification: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'n_1', ...data })),
    },
  };
  const prisma = {
    conversationCall: { findUnique: jest.fn().mockResolvedValue(call) },
    $transaction: jest.fn().mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const fcm = { enqueueNotification: jest.fn().mockResolvedValue(1) } as unknown as FcmService;
  const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as ConfigService;
  return { service: new RealtimeCallsService(prisma, config, fcm), tx, fcm };
};

describe('RealtimeCallsService call_ended push + REST reject', () => {
  it('REST reject by the callee ends the call, emits call:state and pushes call_ended to the callee', async () => {
    const { service, tx, fcm } = setup();
    const view = await service.rejectForBooking(TASKER_ID, UserRole.Tasker, 72, 'call_1');

    expect(view.status).toBe('rejected');
    const events = tx.realtimeOutboxEvent.create.mock.calls.map(([arg]) => arg.data.eventName);
    expect(events).toEqual(['call:state', 'call:state']);
    expect(tx.taskNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: TASKER_ID,
        audienceRole: UserRole.Tasker,
        type: 'call_ended',
        entityId: 'call_1',
        readAt: expect.any(Date),
        metadata: { callId: 'call_1', bookingId: '72', callType: 'voice', status: 'rejected' },
      }),
    });
    expect(fcm.enqueueNotification).toHaveBeenCalledWith(TASKER_ID, 'n_1', 'Call ended', expect.any(String), UserRole.Tasker, tx);
  });

  it('caller cancel pushes call_ended (status cancelled) to the callee', async () => {
    const { service, tx } = setup();
    await service.cancel({ userId: CUSTOMER_ID, role: UserRole.Customer, sessionId: 1, permissions: [] }, { callId: 'call_1' });
    expect(tx.taskNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: TASKER_ID, metadata: expect.objectContaining({ status: 'cancelled' }) }),
    });
  });

  it('only the callee can reject', async () => {
    const { service, fcm } = setup();
    await expect(service.rejectForBooking(CUSTOMER_ID, UserRole.Customer, 72, 'call_1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(fcm.enqueueNotification).not.toHaveBeenCalled();
  });

  it('only while ringing', async () => {
    const { service } = setup(ringingCall({ status: 'accepted' }));
    await expect(service.rejectForBooking(TASKER_ID, UserRole.Tasker, 72, 'call_1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('a call from another booking is not found', async () => {
    const { service } = setup();
    await expect(service.rejectForBooking(TASKER_ID, UserRole.Tasker, 99, 'call_1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('repeating a reject returns the rejected call without a second push', async () => {
    const { service, fcm } = setup(ringingCall({ status: 'rejected' }));
    const view = await service.rejectForBooking(TASKER_ID, UserRole.Tasker, 72, 'call_1');
    expect(view.status).toBe('rejected');
    expect(fcm.enqueueNotification).not.toHaveBeenCalled();
  });
});
