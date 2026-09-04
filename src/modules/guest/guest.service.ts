import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { GuestSessionStatus } from '../../common/enums/guest-session-status.enum';
import type { UpdateLocationDto } from '../../common/dto/update-location.dto';
import { generateOpaqueToken, hashOpaqueToken } from '../../common/utils/crypto.util';
import type { GuestSession } from '../../generated/prisma/client';
import type { CreateGuestTokenDto } from './dto/create-guest-token.dto';
import { GuestRepository } from './guest.repository';

export interface GuestLocationResult {
  guestId: string;
  latitude: number;
  longitude: number;
  locationUpdatedAt: Date;
}

export interface GuestRequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export interface GuestTokenResult {
  guestId: string;
  token: string;
  expiresAt: Date;
}

/** Matches generateOpaqueToken()'s output shape: REFRESH_TOKEN_BYTES random bytes as hex. */
const GUEST_TOKEN_FORMAT = /^[0-9a-f]{128}$/i;

@Injectable()
export class GuestService {
  constructor(
    private readonly repository: GuestRepository,
    private readonly config: ConfigService,
  ) {}

  static looksLikeGuestToken(token: string): boolean {
    return GUEST_TOKEN_FORMAT.test(token);
  }

  async createSession(
    dto: CreateGuestTokenDto,
    metadata: GuestRequestMetadata,
  ): Promise<GuestTokenResult> {
    const token = generateOpaqueToken();
    const guestId = `guest_${randomBytes(12).toString('hex')}`;
    const expiresAt = this.expiry();

    const session = await this.repository.create({
      guestId,
      tokenHash: hashOpaqueToken(token),
      status: GuestSessionStatus.Active,
      deviceId: dto.deviceId ?? null,
      ipAddress: metadata.ipAddress?.slice(0, 64) ?? null,
      userAgent: metadata.userAgent?.slice(0, 512) ?? null,
      expiresAt,
    });

    return { guestId: session.guestId, token, expiresAt: session.expiresAt };
  }

  /**
   * Validates a raw guest token and records activity in one pass. Every
   * failure throws the same generic 401 shape (missing/invalid/expired/
   * revoked are all indistinguishable to a caller who never held a valid
   * token) while still exposing a specific `code` for legitimate clients
   * that do hold one and need to react, e.g. to fetch a fresh token.
   */
  async validateAndTouch(rawToken: string): Promise<GuestSession> {
    const session = await this.repository.findByTokenHash(hashOpaqueToken(rawToken));
    if (!session) {
      throw new UnauthorizedException({
        code: 'GUEST_TOKEN_INVALID',
        message: 'Guest token is invalid.',
      });
    }
    if (session.status === GuestSessionStatus.Revoked) {
      throw new UnauthorizedException({
        code: 'GUEST_TOKEN_REVOKED',
        message: 'Guest token has been revoked.',
      });
    }
    if (session.status === GuestSessionStatus.Expired) {
      throw new UnauthorizedException({
        code: 'GUEST_TOKEN_EXPIRED',
        message: 'Guest token has expired.',
      });
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.repository.markExpired(session.id);
      throw new UnauthorizedException({
        code: 'GUEST_TOKEN_EXPIRED',
        message: 'Guest token has expired.',
      });
    }

    return this.repository.touch(session.id);
  }

  /**
   * Links a guest session to the calling authenticated account. The account
   * is always the caller's own id from the verified session, never a
   * client-supplied value, so this cannot be used to claim someone else's
   * guest browsing history.
   */
  async convert(rawToken: string, userId: number): Promise<{ guestId: string; linked: boolean }> {
    const session = await this.repository.findByTokenHash(hashOpaqueToken(rawToken));
    if (!session) {
      throw new NotFoundException('Guest session not found');
    }
    if (session.convertedUserId !== null) {
      if (session.convertedUserId === userId) return { guestId: session.guestId, linked: true };
      throw new ConflictException('This guest session is already linked to another account');
    }
    if (session.status !== GuestSessionStatus.Active || session.expiresAt.getTime() <= Date.now()) {
      throw new ForbiddenException('Guest session is no longer active');
    }

    const result = await this.repository.convert(session.tokenHash, userId);
    if (result.count === 0) {
      throw new ConflictException('This guest session is already linked to another account');
    }
    if (session.latitude !== null && session.longitude !== null) {
      await this.repository.copyLocationToUserIfMissing(userId, session.latitude, session.longitude);
    }
    return { guestId: session.guestId, linked: true };
  }

  /**
   * Explicit location save for an active guest session. Only this call ever
   * changes the saved coordinates - lat/lng sent to GET /api/taskers are
   * used for that one request only and never persisted here.
   */
  async updateLocation(sessionId: number, dto: UpdateLocationDto): Promise<GuestLocationResult> {
    const session = await this.repository.updateLocation(sessionId, dto.latitude, dto.longitude);
    return {
      guestId: session.guestId,
      latitude: Number(session.latitude),
      longitude: Number(session.longitude),
      locationUpdatedAt: session.locationUpdatedAt as Date,
    };
  }

  /**
   * Maintenance sweep: batch-expires sessions past expiresAt that a request
   * never happened to touch, then hard-deletes expired/revoked rows past the
   * retention window. Bounded by guest.cleanupBatchSize per call so a large
   * backlog cannot turn into one unbounded query; a scheduler runs this
   * repeatedly rather than trying to clear everything in one pass. Active,
   * unexpired sessions are never touched by either step.
   */
  async runOnce(): Promise<{ expired: number; deleted: number }> {
    const batchSize = this.config.get<number>('guest.cleanupBatchSize', 500);
    const expired = await this.repository.expireDue(new Date(), batchSize);
    const retentionDays = this.config.get<number>('guest.retentionDays', 7);
    const olderThan = new Date(Date.now() - retentionDays * 86_400_000);
    const deleted = await this.repository.deleteStale(olderThan, batchSize);
    return { expired, deleted };
  }

  private expiry(): Date {
    const hours = this.config.get<number>('guest.tokenExpiresInHours', 24);
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }
}
