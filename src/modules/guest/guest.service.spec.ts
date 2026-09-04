import { ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GuestSessionStatus } from '../../common/enums/guest-session-status.enum';
import { hashOpaqueToken } from '../../common/utils/crypto.util';
import { GuestService } from './guest.service';
import type { GuestRepository } from './guest.repository';

const config = {
  get: (key: string, fallback: unknown) => {
    if (key === 'guest.tokenExpiresInHours') return 24;
    if (key === 'guest.cleanupBatchSize') return 500;
    if (key === 'guest.retentionDays') return 7;
    return fallback;
  },
} as unknown as ConfigService;

function buildSession(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    guestId: 'guest_test',
    tokenHash: 'hash',
    status: GuestSessionStatus.Active,
    deviceId: null,
    ipAddress: null,
    userAgent: null,
    usageCount: 0,
    latitude: null,
    longitude: null,
    locationUpdatedAt: null,
    convertedUserId: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    lastActivityAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('GuestService.looksLikeGuestToken', () => {
  it('accepts the exact opaque-token shape and rejects a JWT', () => {
    const opaque = 'a'.repeat(128);
    expect(GuestService.looksLikeGuestToken(opaque)).toBe(true);
    expect(
      GuestService.looksLikeGuestToken('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.dGVzdC1zaWduYXR1cmU'),
    ).toBe(false);
    expect(GuestService.looksLikeGuestToken('too-short')).toBe(false);
  });
});

describe('GuestService.createSession', () => {
  it('hashes the token before persisting and returns the raw token only in the result', async () => {
    let stored: Record<string, unknown> | undefined;
    const repository = {
      create: jest.fn((data: Record<string, unknown>) => {
        stored = data;
        return Promise.resolve(buildSession({ ...data, id: 7 }));
      }),
    } as unknown as GuestRepository;

    const service = new GuestService(repository, config);
    const result = await service.createSession(
      { deviceId: 'device-1' },
      { ipAddress: '203.0.113.5', userAgent: 'jest' },
    );

    expect(result.guestId).toMatch(/^guest_[0-9a-f]{24}$/);
    expect(result.token).toMatch(/^[0-9a-f]{128}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);

    expect(stored?.tokenHash).toBe(hashOpaqueToken(result.token));
    expect(stored?.tokenHash).not.toBe(result.token);
    expect(stored).not.toHaveProperty('token');
    expect(stored?.deviceId).toBe('device-1');
    expect(stored?.ipAddress).toBe('203.0.113.5');
    expect(stored?.status).toBe(GuestSessionStatus.Active);
  });

  it('never lets the client choose expiresAt or status', async () => {
    const repository = {
      create: jest.fn((data: Record<string, unknown>) => Promise.resolve(buildSession({ ...data, id: 1 }))),
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);

    // CreateGuestTokenDto only ever carries deviceId; nothing else is read from client input here.
    await service.createSession({ deviceId: undefined }, {});
    const passed = (repository.create as jest.Mock).mock.calls[0][0];
    expect(passed.status).toBe(GuestSessionStatus.Active);
    expect(passed.expiresAt).toBeInstanceOf(Date);
    expect(passed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('GuestService.validateAndTouch', () => {
  it('rejects a token with no matching session', async () => {
    const repository = { findByTokenHash: jest.fn().mockResolvedValue(null) } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await expect(service.validateAndTouch('a'.repeat(128))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a revoked session', async () => {
    const repository = {
      findByTokenHash: jest.fn().mockResolvedValue(buildSession({ status: GuestSessionStatus.Revoked })),
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await expect(service.validateAndTouch('a'.repeat(128))).rejects.toMatchObject({
      response: { code: 'GUEST_TOKEN_REVOKED' },
    });
  });

  it('rejects an already-expired session without re-touching it', async () => {
    const touch = jest.fn();
    const repository = {
      findByTokenHash: jest.fn().mockResolvedValue(buildSession({ status: GuestSessionStatus.Expired })),
      touch,
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await expect(service.validateAndTouch('a'.repeat(128))).rejects.toMatchObject({
      response: { code: 'GUEST_TOKEN_EXPIRED' },
    });
    expect(touch).not.toHaveBeenCalled();
  });

  it('lazily expires a session whose expiresAt has passed even if still marked active', async () => {
    const markExpired = jest.fn().mockResolvedValue({ count: 1 });
    const touch = jest.fn();
    const repository = {
      findByTokenHash: jest.fn().mockResolvedValue(
        buildSession({ status: GuestSessionStatus.Active, expiresAt: new Date(Date.now() - 1_000) }),
      ),
      markExpired,
      touch,
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await expect(service.validateAndTouch('a'.repeat(128))).rejects.toMatchObject({
      response: { code: 'GUEST_TOKEN_EXPIRED' },
    });
    expect(markExpired).toHaveBeenCalledWith(1);
    expect(touch).not.toHaveBeenCalled();
  });

  it('touches and returns an active, unexpired session', async () => {
    const touched = buildSession({ usageCount: 1 });
    const repository = {
      findByTokenHash: jest.fn().mockResolvedValue(buildSession()),
      touch: jest.fn().mockResolvedValue(touched),
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    const result = await service.validateAndTouch('a'.repeat(128));
    expect(result).toBe(touched);
    expect(repository.touch).toHaveBeenCalledWith(1);
  });
});

describe('GuestService.convert', () => {
  it('throws when no session matches the token', async () => {
    const repository = { findByTokenHash: jest.fn().mockResolvedValue(null) } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await expect(service.convert('a'.repeat(128), 42)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is idempotent when already converted to the same account', async () => {
    const repository = {
      findByTokenHash: jest.fn().mockResolvedValue(buildSession({ convertedUserId: 42 })),
      convert: jest.fn(),
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await expect(service.convert('a'.repeat(128), 42)).resolves.toEqual({ guestId: 'guest_test', linked: true });
    expect(repository.convert).not.toHaveBeenCalled();
  });

  it('rejects converting a session already linked to a different account', async () => {
    const repository = {
      findByTokenHash: jest.fn().mockResolvedValue(buildSession({ convertedUserId: 99 })),
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await expect(service.convert('a'.repeat(128), 42)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects converting an expired session', async () => {
    const repository = {
      findByTokenHash: jest
        .fn()
        .mockResolvedValue(buildSession({ expiresAt: new Date(Date.now() - 1_000) })),
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await expect(service.convert('a'.repeat(128), 42)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('links an active session to the given userId, never a client-supplied id from elsewhere', async () => {
    const repository = {
      findByTokenHash: jest.fn().mockResolvedValue(buildSession()),
      convert: jest.fn().mockResolvedValue({ count: 1 }),
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    const result = await service.convert('a'.repeat(128), 42);
    expect(repository.convert).toHaveBeenCalledWith('hash', 42);
    expect(result).toEqual({ guestId: 'guest_test', linked: true });
  });

  it('carries the guest-saved location onto the new account when the session had one saved', async () => {
    const copyLocationToUserIfMissing = jest.fn().mockResolvedValue({ count: 1 });
    const repository = {
      findByTokenHash: jest
        .fn()
        .mockResolvedValue(buildSession({ latitude: 34.02, longitude: -6.83 })),
      convert: jest.fn().mockResolvedValue({ count: 1 }),
      copyLocationToUserIfMissing,
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await service.convert('a'.repeat(128), 42);
    expect(copyLocationToUserIfMissing).toHaveBeenCalledWith(42, 34.02, -6.83);
  });

  it('does not attempt a location carry-over when the guest session never saved one', async () => {
    const copyLocationToUserIfMissing = jest.fn();
    const repository = {
      findByTokenHash: jest.fn().mockResolvedValue(buildSession()),
      convert: jest.fn().mockResolvedValue({ count: 1 }),
      copyLocationToUserIfMissing,
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    await service.convert('a'.repeat(128), 42);
    expect(copyLocationToUserIfMissing).not.toHaveBeenCalled();
  });
});

describe('GuestService.updateLocation', () => {
  it('persists both coordinates and returns the numeric result', async () => {
    const updateLocation = jest.fn().mockResolvedValue(
      buildSession({ latitude: 33.5731, longitude: -7.5898, locationUpdatedAt: new Date('2026-09-04T10:00:00.000Z') }),
    );
    const repository = { updateLocation } as unknown as GuestRepository;
    const service = new GuestService(repository, config);

    const result = await service.updateLocation(3, { latitude: 33.5731, longitude: -7.5898 });

    expect(updateLocation).toHaveBeenCalledWith(3, 33.5731, -7.5898);
    expect(result).toEqual({
      guestId: 'guest_test',
      latitude: 33.5731,
      longitude: -7.5898,
      locationUpdatedAt: new Date('2026-09-04T10:00:00.000Z'),
    });
  });
});

describe('GuestService.runOnce', () => {
  it('expires due sessions and deletes stale rows using configured batch/retention settings', async () => {
    const repository = {
      expireDue: jest.fn().mockResolvedValue(3),
      deleteStale: jest.fn().mockResolvedValue(5),
    } as unknown as GuestRepository;
    const service = new GuestService(repository, config);
    const result = await service.runOnce();
    expect(result).toEqual({ expired: 3, deleted: 5 });
    expect(repository.expireDue).toHaveBeenCalledWith(expect.any(Date), 500);
    expect(repository.deleteStale).toHaveBeenCalledWith(expect.any(Date), 500);
  });
});
