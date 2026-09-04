import { GuestSessionStatus } from '../../common/enums/guest-session-status.enum';
import { GuestRepository } from './guest.repository';
import type { PrismaService } from '../../database/prisma.service';

describe('GuestRepository concurrency-safe writes', () => {
  it('touch() uses an atomic DB-level increment, never a read-then-write update', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = { guestSession: { update } } as unknown as PrismaService;
    const repository = new GuestRepository(prisma);

    await repository.touch(1);

    expect(update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { lastActivityAt: expect.any(Date), usageCount: { increment: 1 } },
    });
  });

  it('markExpired() only transitions rows still active, so a concurrent expiry/revoke cannot be clobbered', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { guestSession: { updateMany } } as unknown as PrismaService;
    const repository = new GuestRepository(prisma);

    await repository.markExpired(5);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: GuestSessionStatus.Active },
      data: { status: GuestSessionStatus.Expired },
    });
  });

  it('convert() only affects a row with no prior conversion, preventing a race from overwriting an existing link', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { guestSession: { updateMany } } as unknown as PrismaService;
    const repository = new GuestRepository(prisma);

    await repository.convert('hash-1', 42);

    expect(updateMany).toHaveBeenCalledWith({
      where: { tokenHash: 'hash-1', convertedUserId: null },
      data: { convertedUserId: 42, status: GuestSessionStatus.Revoked },
    });
  });

  it('deleteStale() only targets expired/revoked rows past the retention window, and is a no-op when there is nothing to delete', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const deleteMany = jest.fn();
    const prisma = { guestSession: { findMany, deleteMany } } as unknown as PrismaService;
    const repository = new GuestRepository(prisma);

    const deleted = await repository.deleteStale(new Date(), 500);

    expect(deleted).toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [GuestSessionStatus.Expired, GuestSessionStatus.Revoked] },
        }),
        take: 500,
      }),
    );
  });

  it('updateLocation() always writes both coordinates together and stamps locationUpdatedAt', async () => {
    const update = jest.fn().mockResolvedValue({});
    const prisma = { guestSession: { update } } as unknown as PrismaService;
    const repository = new GuestRepository(prisma);

    await repository.updateLocation(3, 33.5731, -7.5898);

    expect(update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { latitude: 33.5731, longitude: -7.5898, locationUpdatedAt: expect.any(Date) },
    });
  });

  it('copyLocationToUserIfMissing() only writes when the User has no saved location yet, never overwriting one it already set', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { user: { updateMany } } as unknown as PrismaService;
    const repository = new GuestRepository(prisma);

    await repository.copyLocationToUserIfMissing(42, 34.02 as never, -6.83 as never);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 42, latitude: null, longitude: null },
      data: { latitude: 34.02, longitude: -6.83, locationUpdatedAt: expect.any(Date) },
    });
  });

  it('expireDue() never touches a session that is not both active and past expiresAt', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 9 }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = { guestSession: { findMany, updateMany } } as unknown as PrismaService;
    const repository = new GuestRepository(prisma);

    const now = new Date();
    const expired = await repository.expireDue(now, 500);

    expect(expired).toBe(1);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: GuestSessionStatus.Active, expiresAt: { lte: now } },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: [9] }, status: GuestSessionStatus.Active },
      data: { status: GuestSessionStatus.Expired },
    });
  });
});
