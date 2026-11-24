import { BookingsService } from './bookings.service';

type Session = {
  status: string;
  startedAt: Date;
  pausedAt: Date | null;
  accumulatedPausedSecs: number;
  stoppedAt?: Date | null;
  stopReason?: string | null;
};

const run = async (session: Session | null) => {
  const updates: unknown[] = [];
  const events: unknown[] = [];
  const transaction = {
    taskWorkSession: {
      findUnique: jest.fn().mockResolvedValue(session),
      update: jest.fn().mockImplementation(({ data }) => {
        updates.push(data);
        return Promise.resolve({
          ...session,
          ...data,
          accumulatedPausedSecs: (session?.accumulatedPausedSecs ?? 0) + (data.accumulatedPausedSecs?.increment ?? 0),
        });
      }),
    },
  };
  const service = Object.create(BookingsService.prototype) as BookingsService;
  (service as unknown as { realtime: unknown }).realtime = {
    enqueueBooking: jest.fn().mockImplementation((...args: unknown[]) => {
      events.push(args);
      return Promise.resolve();
    }),
  };
  const now = new Date('2026-11-24T10:00:00.000Z');
  const stopped = await (
    service as unknown as { stopWorkTimerForDispute: (id: number, now: Date, tx: unknown) => Promise<boolean> }
  ).stopWorkTimerForDispute(72, now, transaction);
  return { stopped, updates, events, now };
};

describe('dispute filing stops the work timer', () => {
  it('stops a running timer at the filing moment with stopReason=dispute_filed and broadcasts it', async () => {
    const { stopped, updates, events, now } = await run({
      status: 'running',
      startedAt: new Date('2026-11-24T09:00:00.000Z'),
      pausedAt: null,
      accumulatedPausedSecs: 0,
    });
    expect(stopped).toBe(true);
    expect(updates[0]).toMatchObject({ status: 'stopped', stoppedAt: now, stopReason: 'dispute_filed', accumulatedPausedSecs: { increment: 0 } });
    expect(events[0]).toEqual(expect.arrayContaining([72, 'booking:timer', expect.objectContaining({ status: 'stopped', stopReason: 'dispute_filed' })]));
  });

  it('counts the open pause so a paused timer does not bill the paused time', async () => {
    const { updates } = await run({
      status: 'paused',
      startedAt: new Date('2026-11-24T08:00:00.000Z'),
      pausedAt: new Date('2026-11-24T09:30:00.000Z'),
      accumulatedPausedSecs: 60,
    });
    expect(updates[0]).toMatchObject({ status: 'stopped', accumulatedPausedSecs: { increment: 1800 } });
  });

  it('does nothing when there is no timer or it is already stopped', async () => {
    expect((await run(null)).stopped).toBe(false);
    const already = await run({ status: 'stopped', startedAt: new Date(), pausedAt: null, accumulatedPausedSecs: 0 });
    expect(already.stopped).toBe(false);
    expect(already.updates).toHaveLength(0);
  });
});
