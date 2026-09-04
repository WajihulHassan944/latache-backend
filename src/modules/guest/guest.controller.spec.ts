import 'reflect-metadata';
import { GuestController } from './guest.controller';
import type { GuestService } from './guest.service';
import type { User } from '../../generated/prisma/client';

describe('GuestController', () => {
  it('creates a token using request IP/User-Agent and the caller-supplied deviceId', async () => {
    const guests = {
      createSession: jest.fn().mockResolvedValue({
        guestId: 'guest_x',
        token: 'a'.repeat(128),
        expiresAt: new Date(),
      }),
    } as unknown as GuestService;
    const controller = new GuestController(guests);

    const request = {
      ip: '203.0.113.7',
      headers: { 'user-agent': 'jest-agent' },
    } as unknown as Parameters<GuestController['createToken']>[1];

    await controller.createToken({ deviceId: 'device-1' }, request);

    expect(guests.createSession).toHaveBeenCalledWith(
      { deviceId: 'device-1' },
      { ipAddress: '203.0.113.7', userAgent: 'jest-agent' },
    );
  });

  it('never returns tokenHash from the creation response', async () => {
    const guests = {
      createSession: jest
        .fn()
        .mockResolvedValue({ guestId: 'guest_x', token: 'a'.repeat(128), expiresAt: new Date() }),
    } as unknown as GuestService;
    const controller = new GuestController(guests);
    const request = { ip: '127.0.0.1', headers: {} } as unknown as Parameters<
      GuestController['createToken']
    >[1];

    const result = await controller.createToken({}, request);
    expect(result).not.toHaveProperty('tokenHash');
    expect(Object.keys(result).sort()).toEqual(['expiresAt', 'guestId', 'token']);
  });

  it('converts using the authenticated caller id, ignoring any user-supplied id', async () => {
    const guests = {
      convert: jest.fn().mockResolvedValue({ guestId: 'guest_x', linked: true }),
    } as unknown as GuestService;
    const controller = new GuestController(guests);

    const user = { id: 42 } as User;
    await controller.convert(user, { guestToken: 'a'.repeat(128) });

    expect(guests.convert).toHaveBeenCalledWith('a'.repeat(128), 42);
  });

  it('rate-limits token creation', () => {
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', GuestController.prototype.createToken);
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', GuestController.prototype.createToken);
    expect(limit).toBeGreaterThan(0);
    expect(ttl).toBeGreaterThan(0);
  });
});
