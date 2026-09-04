import { Injectable } from '@nestjs/common';
import { GuestSessionStatus } from '../../common/enums/guest-session-status.enum';
import { PrismaService } from '../../database/prisma.service';
import type { GuestSession, Prisma } from '../../generated/prisma/client';

@Injectable()
export class GuestRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.GuestSessionUncheckedCreateInput): Promise<GuestSession> {
    return this.prisma.guestSession.create({ data });
  }

  findByTokenHash(tokenHash: string): Promise<GuestSession | null> {
    return this.prisma.guestSession.findUnique({ where: { tokenHash } });
  }

  /** Atomic: safe under concurrent requests using the same token. */
  touch(id: number): Promise<GuestSession> {
    return this.prisma.guestSession.update({
      where: { id },
      data: { lastActivityAt: new Date(), usageCount: { increment: 1 } },
    });
  }

  /** Only transitions rows that are still active, so a race with another expiry/revoke is a no-op. */
  markExpired(id: number): Promise<Prisma.BatchPayload> {
    return this.prisma.guestSession.updateMany({
      where: { id, status: GuestSessionStatus.Active },
      data: { status: GuestSessionStatus.Expired },
    });
  }

  revoke(id: number): Promise<Prisma.BatchPayload> {
    return this.prisma.guestSession.updateMany({
      where: { id, status: GuestSessionStatus.Active },
      data: { status: GuestSessionStatus.Revoked },
    });
  }

  /**
   * Links the session to the authenticated account and revokes it as a guest
   * credential in one step; only affects a row with no prior conversion, so
   * a session already linked to a different user is left untouched.
   */
  convert(tokenHash: string, userId: number): Promise<Prisma.BatchPayload> {
    return this.prisma.guestSession.updateMany({
      where: { tokenHash, convertedUserId: null },
      data: { convertedUserId: userId, status: GuestSessionStatus.Revoked },
    });
  }

  findById(id: number): Promise<GuestSession | null> {
    return this.prisma.guestSession.findUnique({ where: { id } });
  }

  /** Explicit location save; always overwrites both coordinates together and stamps locationUpdatedAt. */
  updateLocation(id: number, latitude: number, longitude: number): Promise<GuestSession> {
    return this.prisma.guestSession.update({
      where: { id },
      data: { latitude, longitude, locationUpdatedAt: new Date() },
    });
  }

  /**
   * Best-effort continuity when a guest converts to a real account: carries
   * the guest's saved location onto the User row only if that account has no
   * saved location of its own yet, so this never overwrites a location the
   * Customer already set explicitly.
   */
  copyLocationToUserIfMissing(
    userId: number,
    latitude: Prisma.Decimal,
    longitude: Prisma.Decimal,
  ): Promise<Prisma.BatchPayload> {
    return this.prisma.user.updateMany({
      where: { id: userId, latitude: null, longitude: null },
      data: { latitude, longitude, locationUpdatedAt: new Date() },
    });
  }

  /** Hard-deletes expired/revoked rows past the retention window, in bounded batches. */
  async deleteStale(olderThan: Date, batchSize: number): Promise<number> {
    const stale = await this.prisma.guestSession.findMany({
      where: {
        status: { in: [GuestSessionStatus.Expired, GuestSessionStatus.Revoked] },
        updatedAt: { lt: olderThan },
      },
      select: { id: true },
      take: batchSize,
    });
    if (!stale.length) return 0;
    const result = await this.prisma.guestSession.deleteMany({
      where: { id: { in: stale.map((row) => row.id) } },
    });
    return result.count;
  }

  /** Batch-expires rows whose expiresAt has passed but are still marked active. */
  async expireDue(now: Date, batchSize: number): Promise<number> {
    const due = await this.prisma.guestSession.findMany({
      where: { status: GuestSessionStatus.Active, expiresAt: { lte: now } },
      select: { id: true },
      take: batchSize,
    });
    if (!due.length) return 0;
    const result = await this.prisma.guestSession.updateMany({
      where: { id: { in: due.map((row) => row.id) }, status: GuestSessionStatus.Active },
      data: { status: GuestSessionStatus.Expired },
    });
    return result.count;
  }
}
