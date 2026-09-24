import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../database/prisma.service';
import { FcmService } from './fcm.service';

type SentMessage = {
  message: {
    token: string;
    notification?: unknown;
    data: Record<string, unknown>;
    android: unknown;
    apns: unknown;
  };
};

const delivery = {
  id: 'd1',
  token: 'device-token',
  tokenId: 't1',
  notificationId: 'n1',
  title: 'Customer paid - task confirmed',
  body: 'The customer paid for booking #12.',
  type: 'booking_payment_captured',
  category: 'tasks',
  entityType: 'booking',
  entityId: '12',
  metadata: { bookingId: 12, nested: { a: 1 }, title: 'metadata title must not win', flag: true },
};

async function captureSend(overrides: Partial<typeof delivery> = {}): Promise<SentMessage> {
  const config = { getOrThrow: () => 'latache-test' } as unknown as ConfigService;
  const service = new FcmService({} as PrismaService, config);
  (service as unknown as { getAccessToken: () => Promise<string> }).getAccessToken = async () => 'oauth-token';
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
  const original = global.fetch;
  global.fetch = fetchMock as unknown as typeof fetch;
  try {
    await (service as unknown as { send: (d: unknown) => Promise<string> }).send({ ...delivery, ...overrides });
  } finally {
    global.fetch = original;
  }
  return JSON.parse(fetchMock.mock.calls[0][1].body as string) as SentMessage;
}

describe('FcmService.send payload (data-only)', () => {
  it('sends no top-level notification block (prevents FCM-web double display)', async () => {
    const sent = await captureSend();
    expect(sent.message).not.toHaveProperty('notification');
  });

  it('moves title and body into data as strings', async () => {
    const { data } = (await captureSend()).message;
    expect(data.title).toBe('Customer paid - task confirmed');
    expect(data.body).toBe('The customer paid for booking #12.');
  });

  it('keeps every existing data field unchanged', async () => {
    const { data } = (await captureSend()).message;
    expect(data).toMatchObject({
      notificationId: 'n1',
      type: 'booking_payment_captured',
      category: 'tasks',
      entityType: 'booking',
      entityId: '12',
      bookingId: '12',
      nested: JSON.stringify({ a: 1 }),
      flag: 'true',
    });
  });

  it('never lets metadata override the notification title/body', async () => {
    const { data } = (await captureSend()).message;
    expect(data.title).toBe(delivery.title);
  });

  it('every data value is a string (FCM requirement)', async () => {
    const { data } = (await captureSend({ type: null, category: null, entityType: null, entityId: null } as never)).message;
    expect(Object.values(data).every((value) => typeof value === 'string')).toBe(true);
    expect(data).not.toHaveProperty('type');
  });

  it('keeps platform delivery options (android/apns) as before', async () => {
    const { message } = await captureSend();
    expect(message.token).toBe('device-token');
    expect(message.android).toBeDefined();
    expect(message.apns).toBeDefined();
  });
});
