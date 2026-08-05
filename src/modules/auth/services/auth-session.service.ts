import { Injectable, NotFoundException } from '@nestjs/common';
import { success, type SuccessEnvelope } from '../auth-response';
import { AuthSessionsRepository } from '../repositories/auth-sessions.repository';

@Injectable()
export class AuthSessionService {
  constructor(private readonly sessions: AuthSessionsRepository) {}

  async list(userId: number): Promise<SuccessEnvelope<{ sessions: unknown[] }>> {
    const sessions = await this.sessions.listActive(userId);
    return success(
      {
        sessions: sessions.map((session) => ({
          id: session.id,
          device: session.device,
          ipAddress: session.ipAddress,
          userAgent: session.userAgent,
          lastUsedAt: session.lastUsedAt,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        })),
      },
      'Active sessions retrieved.',
    );
  }

  async logout(userId: number, sessionId: number): Promise<SuccessEnvelope<null>> {
    await this.sessions.revokeById(userId, sessionId);
    return success(null, 'Logout successful.');
  }

  async logoutAll(userId: number): Promise<SuccessEnvelope<null>> {
    await this.sessions.revokeAll(userId);
    return success(null, 'Logged out from all devices successfully.');
  }

  async revoke(userId: number, sessionId: number): Promise<SuccessEnvelope<null>> {
    const result = await this.sessions.revokeById(userId, sessionId);
    if (result.count === 0) throw new NotFoundException('Active session not found');
    return success(null, 'Session revoked successfully.');
  }
}
