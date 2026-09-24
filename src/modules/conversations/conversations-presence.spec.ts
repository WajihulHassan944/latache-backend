import { ConversationsService } from './conversations.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const person = (lastSeenAt: Date | null) => ({
  id: 31,
  firstName: 'Ayesha',
  lastName: 'Khan',
  profilePicture: null,
  phoneCountryCode: '+92',
  phoneNumber: '3001234567',
  lastSeenAt,
});

const summarize = (row: ReturnType<typeof person>) =>
  (Object.create(ConversationsService.prototype) as unknown as {
    personSummary: (p: unknown, role: string) => Record<string, unknown>;
  }).personSummary(row, 'tasker');

describe('PersonSummaryView.lastSeenAt (presence initial snapshot)', () => {
  it('exposes the last presence timestamp as ISO 8601', () => {
    const seen = new Date('2026-09-24T10:15:00.000Z');
    expect(summarize(person(seen)).lastSeenAt).toBe('2026-09-24T10:15:00.000Z');
  });

  it('returns null for a user who never connected (no error, no default)', () => {
    expect(summarize(person(null)).lastSeenAt).toBeNull();
  });

  it('leaves the other summary fields unchanged', () => {
    expect(summarize(person(null))).toEqual({
      id: '31',
      name: 'Ayesha Khan',
      avatar: '',
      role: 'tasker',
      phoneCountryCode: '+92',
      phoneNumber: '3001234567',
      lastSeenAt: null,
    });
  });
});

describe('presence writes lastSeenAt on every transition', () => {
  const build = (counterparties: number[]) => {
    const gateway = Object.create(RealtimeGateway.prototype) as RealtimeGateway;
    const update = jest.fn().mockResolvedValue({ id: 3 });
    const emit = jest.fn();
    Object.assign(gateway, {
      prisma: { user: { update } },
      server: { to: jest.fn().mockReturnValue({ emit }) },
      logger: { error: jest.fn() },
      presenceCounterpartyIds: jest.fn().mockResolvedValue(counterparties),
    });
    const broadcast = (status: 'online' | 'offline') =>
      (gateway as unknown as { broadcastPresence: (id: number, s: string) => Promise<void> }).broadcastPresence(3, status);
    return { broadcast, update, emit };
  };

  it('stamps lastSeenAt when a user comes online, so a first connection is not reported as null', async () => {
    const { broadcast, update } = build([31]);
    await broadcast('online');
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 3 }, data: { lastSeenAt: expect.any(Date) } }));
  });

  it('stamps it even when the user has no counterparties yet', async () => {
    const { broadcast, update, emit } = build([]);
    await broadcast('online');
    expect(update).toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('offline event still carries the stamped lastSeenAt', async () => {
    const { broadcast, emit } = build([31]);
    await broadcast('offline');
    expect(emit).toHaveBeenCalledWith('presence:offline', expect.objectContaining({ userId: '3', status: 'offline', lastSeenAt: expect.any(String) }));
  });
});
