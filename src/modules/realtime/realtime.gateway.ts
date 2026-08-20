import { HttpException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { UserRole } from '../../common/enums/user-role.enum';
import type { AccessTokenPayload } from '../../common/types/jwt-payload';
import { extractBearerToken } from '../../common/utils/token.util';
import { PrismaService } from '../../database/prisma.service';
import { AuthSessionsRepository } from '../auth/repositories/auth-sessions.repository';
import { AuthRoleService } from '../auth/services/auth-role.service';
import { UsersService } from '../users/users.service';
import { RealtimeCallsService } from './realtime-calls.service';
import { REALTIME_NAMESPACE, realtimeRoom } from './realtime.constants';
import type {
  BookingSubscriptionPayload,
  CallActionPayload,
  CallIceCandidatePayload,
  CallInitiatePayload,
  CallMediaStatePayload,
  CallSdpPayload,
  ConversationCallView,
  ConversationTypingPayload,
  RealtimeEnvelope,
  RealtimeSocketIdentity,
  SupportSubscriptionPayload,
  SupportTypingPayload,
} from './realtime.types';

interface LatacheSocket extends Socket {
  data: RealtimeSocketIdentity;
}

interface SignalRateBucket {
  startedAt: number;
  count: number;
}

@WebSocketGateway({
  namespace: REALTIME_NAMESPACE,
  transports: ['websocket'],
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly signalRate = new Map<string, SignalRateBucket>();
  private readonly typingRate = new Map<string, Map<string, number>>();

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly sessions: AuthSessionsRepository,
    private readonly roles: AuthRoleService,
    private readonly calls: RealtimeCallsService,
  ) {}

  async handleConnection(client: LatacheSocket): Promise<void> {
    if (!this.config.get<boolean>('realtime.enabled', true)) {
      client.disconnect(true);
      return;
    }

    try {
      const identity = await this.authenticate(client);
      client.data = identity;
      await Promise.all([
        client.join(realtimeRoom.user(identity.userId)),
        client.join(realtimeRoom.userRole(identity.userId, identity.role)),
      ]);
      this.logger.debug(`Realtime socket connected for user ${identity.userId}`);
    } catch (error) {
      this.logger.warn(
        `Rejected realtime connection: ${error instanceof Error ? error.message : String(error)}`,
      );
      client.emit('realtime:error', { message: 'Realtime authentication failed' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: LatacheSocket): void {
    this.signalRate.delete(client.id);
    this.typingRate.delete(client.id);
    if (client.data?.userId) {
      this.logger.debug(`Realtime socket disconnected for user ${client.data.userId}`);
    }
  }

  emitEnvelope(room: string, eventName: string, envelope: RealtimeEnvelope): void {
    if (!this.server) return;
    this.server.to(room).emit(eventName, envelope);
  }

  @SubscribeMessage('booking:subscribe')
  async subscribeBooking(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: BookingSubscriptionPayload,
  ): Promise<{ subscribed: true; bookingId: number; conversation: boolean }> {
    const bookingId = this.requirePositiveId(payload?.bookingId, 'bookingId');
    const participant = await this.assertBookingReadable(client.data, bookingId);
    await client.join(realtimeRoom.booking(bookingId));
    if (participant) await client.join(realtimeRoom.conversation(bookingId));
    return { subscribed: true, bookingId, conversation: participant };
  }

  @SubscribeMessage('booking:unsubscribe')
  async unsubscribeBooking(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: BookingSubscriptionPayload,
  ): Promise<{ subscribed: false; bookingId: number }> {
    const bookingId = this.requirePositiveId(payload?.bookingId, 'bookingId');
    await Promise.all([
      client.leave(realtimeRoom.booking(bookingId)),
      client.leave(realtimeRoom.conversation(bookingId)),
    ]);
    return { subscribed: false, bookingId };
  }

  @SubscribeMessage('support:subscribe')
  async subscribeSupport(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: SupportSubscriptionPayload,
  ): Promise<{ subscribed: true; ticketId: number; admin: boolean }> {
    const ticketId = this.requirePositiveId(payload?.ticketId, 'ticketId');
    const access = await this.assertSupportReadable(client.data, ticketId);
    await client.join(realtimeRoom.supportPublic(ticketId));
    if (access.admin) await client.join(realtimeRoom.supportAdmins(ticketId));
    return { subscribed: true, ticketId, admin: access.admin };
  }

  @SubscribeMessage('support:unsubscribe')
  async unsubscribeSupport(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: SupportSubscriptionPayload,
  ): Promise<{ subscribed: false; ticketId: number }> {
    const ticketId = this.requirePositiveId(payload?.ticketId, 'ticketId');
    await Promise.all([
      client.leave(realtimeRoom.supportPublic(ticketId)),
      client.leave(realtimeRoom.supportAdmins(ticketId)),
    ]);
    return { subscribed: false, ticketId };
  }

  @SubscribeMessage('conversation:typing')
  async conversationTyping(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: ConversationTypingPayload,
  ): Promise<{ accepted: true }> {
    const bookingId = this.requirePositiveId(payload?.bookingId, 'bookingId');
    if (typeof payload?.isTyping !== 'boolean') throw new WsException('isTyping must be a boolean');
    const room = realtimeRoom.conversation(bookingId);
    if (!client.rooms.has(room)) {
      throw new WsException('Subscribe to this conversation before sending typing events');
    }
    if (!this.acceptTyping(client.id, room)) return { accepted: true };
    client.to(room).emit('conversation:typing', {
      bookingId,
      userId: client.data.userId,
      isTyping: payload.isTyping,
    });
    return { accepted: true };
  }

  @SubscribeMessage('support:typing')
  async supportTyping(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: SupportTypingPayload,
  ): Promise<{ accepted: true }> {
    const ticketId = this.requirePositiveId(payload?.ticketId, 'ticketId');
    if (typeof payload?.isTyping !== 'boolean') throw new WsException('isTyping must be a boolean');
    const scope = payload?.scope ?? 'public';
    if (!['public', 'internal'].includes(scope)) {
      throw new WsException('scope must be public or internal');
    }
    const isSupportWriter =
      client.data.role === UserRole.SuperAdmin ||
      (client.data.role === UserRole.Admin && client.data.permissions.includes('support.manage'));
    if (client.data.role === UserRole.Admin || client.data.role === UserRole.SuperAdmin) {
      if (!isSupportWriter)
        throw new WsException('support.manage is required to send typing events');
    }
    if (scope === 'internal' && !isSupportWriter) {
      throw new WsException('Only support administrators can send internal typing events');
    }
    const room =
      scope === 'internal'
        ? realtimeRoom.supportAdmins(ticketId)
        : realtimeRoom.supportPublic(ticketId);
    if (!client.rooms.has(room)) {
      throw new WsException('Subscribe to this support ticket before sending typing events');
    }
    if (!this.acceptTyping(client.id, room)) return { accepted: true };
    client.to(room).emit('support:typing', {
      ticketId,
      userId: client.data.userId,
      role: client.data.role,
      scope,
      isTyping: payload.isTyping,
    });
    return { accepted: true };
  }

  private acceptTyping(socketId: string, room: string): boolean {
    const now = Date.now();
    const throttleMs = this.config.get<number>('realtime.typingThrottleMs', 300);
    const byRoom = this.typingRate.get(socketId) ?? new Map<string, number>();
    const lastAt = byRoom.get(room) ?? 0;
    if (now - lastAt < throttleMs) return false;
    byRoom.set(room, now);
    this.typingRate.set(socketId, byRoom);
    return true;
  }

  @SubscribeMessage('call:initiate')
  async initiateCall(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: CallInitiatePayload,
  ): Promise<ConversationCallView> {
    const normalized: CallInitiatePayload = {
      bookingId: this.requirePositiveId(payload?.bookingId, 'bookingId'),
      type: this.requireCallType(payload?.type),
      clientRequestId: this.requireString(payload?.clientRequestId, 'clientRequestId', 8, 80),
    };
    return this.callOperation(client, 'call:initiate', () =>
      this.calls.initiate(client.data, normalized),
    );
  }

  @SubscribeMessage('call:accept')
  async acceptCall(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: CallActionPayload,
  ): Promise<ConversationCallView> {
    return this.callOperation(client, 'call:accept', () =>
      this.calls.accept(client.data, this.normalizeCallAction(payload)),
    );
  }

  @SubscribeMessage('call:reject')
  async rejectCall(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: CallActionPayload,
  ): Promise<ConversationCallView> {
    return this.callOperation(client, 'call:reject', () =>
      this.calls.reject(client.data, this.normalizeCallAction(payload)),
    );
  }

  @SubscribeMessage('call:cancel')
  async cancelCall(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: CallActionPayload,
  ): Promise<ConversationCallView> {
    return this.callOperation(client, 'call:cancel', () =>
      this.calls.cancel(client.data, this.normalizeCallAction(payload)),
    );
  }

  @SubscribeMessage('call:end')
  async endCall(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: CallActionPayload,
  ): Promise<ConversationCallView> {
    return this.callOperation(client, 'call:end', () =>
      this.calls.end(client.data, this.normalizeCallAction(payload)),
    );
  }

  @SubscribeMessage('call:offer')
  async callOffer(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: CallSdpPayload,
  ): Promise<{ forwarded: true; callId: string }> {
    this.assertCallSignalRate(client);
    const normalized = this.normalizeSdp(payload, 'offer');
    const target = await this.callOperation(client, 'call:signal', () =>
      this.calls.signalTarget(client.data, normalized.callId),
    );
    this.server.to(realtimeRoom.userRole(target.targetUserId, target.targetRole)).emit('call:offer', {
      callId: normalized.callId,
      bookingId: String(target.call.bookingId),
      fromUserId: String(client.data.userId),
      description: normalized.description,
      sentAt: new Date().toISOString(),
    });
    return { forwarded: true, callId: normalized.callId };
  }

  @SubscribeMessage('call:answer')
  async callAnswer(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: CallSdpPayload,
  ): Promise<{ forwarded: true; callId: string }> {
    this.assertCallSignalRate(client);
    const normalized = this.normalizeSdp(payload, 'answer');
    const target = await this.callOperation(client, 'call:signal', () =>
      this.calls.signalTarget(client.data, normalized.callId),
    );
    this.server.to(realtimeRoom.userRole(target.targetUserId, target.targetRole)).emit('call:answer', {
      callId: normalized.callId,
      bookingId: String(target.call.bookingId),
      fromUserId: String(client.data.userId),
      description: normalized.description,
      sentAt: new Date().toISOString(),
    });
    return { forwarded: true, callId: normalized.callId };
  }

  @SubscribeMessage('call:ice_candidate')
  async callIceCandidate(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: CallIceCandidatePayload,
  ): Promise<{ forwarded: true; callId: string }> {
    this.assertCallSignalRate(client);
    const normalized = this.normalizeIceCandidate(payload);
    const target = await this.callOperation(client, 'call:signal', () =>
      this.calls.signalTarget(client.data, normalized.callId),
    );
    this.server.to(realtimeRoom.userRole(target.targetUserId, target.targetRole)).emit('call:ice_candidate', {
      callId: normalized.callId,
      bookingId: String(target.call.bookingId),
      fromUserId: String(client.data.userId),
      candidate: normalized.candidate,
      sentAt: new Date().toISOString(),
    });
    return { forwarded: true, callId: normalized.callId };
  }

  @SubscribeMessage('call:media_state')
  async callMediaState(
    @ConnectedSocket() client: LatacheSocket,
    @MessageBody() payload: CallMediaStatePayload,
  ): Promise<{ forwarded: true; callId: string }> {
    this.assertCallSignalRate(client);
    const normalized = this.normalizeMediaState(payload);
    const target = await this.callOperation(client, 'call:signal', () =>
      this.calls.signalTarget(client.data, normalized.callId),
    );
    this.server.to(realtimeRoom.userRole(target.targetUserId, target.targetRole)).emit('call:media_state', {
      callId: normalized.callId,
      bookingId: String(target.call.bookingId),
      fromUserId: String(client.data.userId),
      microphoneEnabled: normalized.microphoneEnabled,
      cameraEnabled: normalized.cameraEnabled,
      speakerEnabled: normalized.speakerEnabled,
      sentAt: new Date().toISOString(),
    });
    return { forwarded: true, callId: normalized.callId };
  }

  async sweepInvalidSessions(): Promise<void> {
    if (!this.server) return;
    const sockets = [...this.server.sockets.values()] as LatacheSocket[];
    const identities = sockets
      .map((socket) => socket.data)
      .filter((value): value is RealtimeSocketIdentity =>
        Boolean(value?.sessionId && value?.userId),
      );
    if (identities.length === 0) return;

    const sessionIds = [...new Set(identities.map((identity) => identity.sessionId))];
    const userIds = [...new Set(identities.map((identity) => identity.userId))];
    const now = new Date();
    const [activeSessions, activeUsers] = await Promise.all([
      this.prisma.refreshToken.findMany({
        where: { id: { in: sessionIds }, revokedAt: null, expiresAt: { gt: now } },
        select: { id: true, userId: true },
      }),
      this.prisma.user.findMany({
        where: {
          id: { in: userIds },
          deletedAt: null,
          accountStatus: { notIn: [AccountStatus.Suspended, AccountStatus.Deactivated] },
        },
        select: { id: true },
      }),
    ]);
    const sessionKeys = new Set(activeSessions.map((session) => `${session.id}:${session.userId}`));
    const activeUserIds = new Set(activeUsers.map((user) => user.id));

    for (const socket of sockets) {
      const identity = socket.data;
      if (!identity) continue;
      if (
        !activeUserIds.has(identity.userId) ||
        !sessionKeys.has(`${identity.sessionId}:${identity.userId}`)
      ) {
        socket.emit('auth:session_invalid', { reason: 'session_revoked_or_account_disabled' });
        socket.disconnect(true);
      }
    }
  }

  private async authenticate(client: LatacheSocket): Promise<RealtimeSocketIdentity> {
    const authToken =
      typeof client.handshake.auth?.token === 'string' ? client.handshake.auth.token : undefined;
    const header =
      typeof client.handshake.headers.authorization === 'string'
        ? client.handshake.headers.authorization
        : undefined;
    const token = authToken || extractBearerToken(header);
    if (!token) throw new WsException('Bearer token is required');

    const payload = await this.verifyToken(token);
    const userId = Number(payload.sub ?? payload.id);
    const sessionId = Number(payload.sessionId);
    if (
      !Number.isSafeInteger(userId) ||
      userId < 1 ||
      !Number.isSafeInteger(sessionId) ||
      sessionId < 1
    ) {
      throw new WsException('Token is invalid');
    }

    const [user, session] = await Promise.all([
      this.users.findById(userId),
      this.sessions.findActiveById(sessionId, userId),
    ]);
    if (!user || user.deletedAt || !session) throw new WsException('Session is invalid or expired');
    if (session.activeRole && session.activeRole !== payload.role) {
      throw new WsException('Session role does not match this access token');
    }
    if (
      [AccountStatus.Suspended, AccountStatus.Deactivated].includes(
        user.accountStatus as AccountStatus,
      )
    ) {
      throw new WsException('Account cannot use realtime features');
    }

    await this.roles.assertSelectable(user, payload.role);
    return {
      userId,
      sessionId,
      role: payload.role,
      permissions: user.permissions,
    };
  }

  private async verifyToken(token: string): Promise<AccessTokenPayload> {
    const secrets = [
      this.config.get<string>('auth.jwtSecret'),
      this.config.get<string>('auth.adminJwtSecret'),
    ].filter((value): value is string => Boolean(value));
    for (const secret of [...new Set(secrets)]) {
      try {
        return await this.jwt.verifyAsync<AccessTokenPayload>(token, { secret });
      } catch {
        // Try the other configured access-token secret.
      }
    }
    throw new WsException('Token is invalid or expired');
  }

  private async assertBookingParticipant(userId: number, bookingId: number): Promise<void> {
    const count = await this.prisma.booking.count({
      where: { id: bookingId, OR: [{ customerId: userId }, { taskerId: userId }] },
    });
    if (!count) throw new WsException('Booking is not accessible');
  }

  private async assertBookingReadable(
    identity: RealtimeSocketIdentity,
    bookingId: number,
  ): Promise<boolean> {
    const participant = await this.prisma.booking.count({
      where: {
        id: bookingId,
        ...(identity.role === UserRole.Customer
          ? { customerId: identity.userId }
          : identity.role === UserRole.Tasker
            ? { taskerId: identity.userId }
            : { id: -1 }),
      },
    });
    if (participant) return true;
    if (identity.role === UserRole.SuperAdmin || identity.permissions.includes('bookings.read')) {
      const exists = await this.prisma.booking.count({ where: { id: bookingId } });
      if (exists) return false;
    }
    throw new WsException('Booking is not accessible');
  }

  private async assertSupportReadable(
    identity: RealtimeSocketIdentity,
    ticketId: number,
  ): Promise<{ admin: boolean }> {
    const admin =
      identity.role === UserRole.SuperAdmin ||
      (identity.role === UserRole.Admin && identity.permissions.includes('support.read'));
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { userId: true, requesterRole: true },
    });
    if (!ticket) throw new WsException('Support ticket not found');
    if (admin) return { admin: true };
    if (ticket.userId === identity.userId && ticket.requesterRole === identity.role) return { admin: false };
    throw new WsException('Support ticket is not accessible');
  }

  private requirePositiveId(value: unknown, field: string): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1)
      throw new WsException(`${field} must be a positive integer`);
    return parsed;
  }

  private requireString(value: unknown, field: string, minimum: number, maximum: number): string {
    if (typeof value !== 'string') throw new WsException(`${field} must be a string`);
    const normalized = value.trim();
    if (normalized.length < minimum || normalized.length > maximum) {
      throw new WsException(`${field} must contain between ${minimum} and ${maximum} characters`);
    }
    return normalized;
  }

  private requireCallType(value: unknown): 'voice' | 'video' {
    if (value !== 'voice' && value !== 'video') {
      throw new WsException('type must be voice or video');
    }
    return value;
  }

  private normalizeCallAction(payload: CallActionPayload): CallActionPayload {
    const callId = this.requireString(payload?.callId, 'callId', 1, 80);
    const reason =
      payload?.reason === undefined
        ? undefined
        : this.requireString(payload.reason, 'reason', 1, 120);
    return { callId, ...(reason ? { reason } : {}) };
  }

  private normalizeSdp(payload: CallSdpPayload, expectedType: 'offer' | 'answer'): CallSdpPayload {
    const callId = this.requireString(payload?.callId, 'callId', 1, 80);
    if (!payload?.description || payload.description.type !== expectedType) {
      throw new WsException(`description.type must be ${expectedType}`);
    }
    const sdp = this.requireString(payload.description.sdp, 'description.sdp', 1, 200_000);
    return { callId, description: { type: expectedType, sdp } };
  }

  private normalizeIceCandidate(payload: CallIceCandidatePayload): CallIceCandidatePayload {
    const callId = this.requireString(payload?.callId, 'callId', 1, 80);
    if (!payload?.candidate || typeof payload.candidate.candidate !== 'string') {
      throw new WsException('candidate.candidate must be a string');
    }
    if (payload.candidate.candidate.length > 8192) {
      throw new WsException('candidate.candidate exceeds 8192 characters');
    }
    const sdpMid = payload.candidate.sdpMid;
    if (
      sdpMid !== undefined &&
      sdpMid !== null &&
      (typeof sdpMid !== 'string' || sdpMid.length > 256)
    ) {
      throw new WsException('candidate.sdpMid is invalid');
    }
    const sdpMLineIndex = payload.candidate.sdpMLineIndex;
    if (
      sdpMLineIndex !== undefined &&
      sdpMLineIndex !== null &&
      (!Number.isInteger(sdpMLineIndex) || sdpMLineIndex < 0 || sdpMLineIndex > 65_535)
    ) {
      throw new WsException('candidate.sdpMLineIndex is invalid');
    }
    const usernameFragment = payload.candidate.usernameFragment;
    if (
      usernameFragment !== undefined &&
      usernameFragment !== null &&
      (typeof usernameFragment !== 'string' || usernameFragment.length > 256)
    ) {
      throw new WsException('candidate.usernameFragment is invalid');
    }
    return {
      callId,
      candidate: {
        candidate: payload.candidate.candidate,
        ...(sdpMid !== undefined ? { sdpMid } : {}),
        ...(sdpMLineIndex !== undefined ? { sdpMLineIndex } : {}),
        ...(usernameFragment !== undefined ? { usernameFragment } : {}),
      },
    };
  }

  private normalizeMediaState(payload: CallMediaStatePayload): CallMediaStatePayload {
    const callId = this.requireString(payload?.callId, 'callId', 1, 80);
    const values = [payload?.microphoneEnabled, payload?.cameraEnabled, payload?.speakerEnabled];
    if (values.every((value) => value === undefined)) {
      throw new WsException('At least one media state must be supplied');
    }
    if (values.some((value) => value !== undefined && typeof value !== 'boolean')) {
      throw new WsException('Media state values must be booleans');
    }
    return {
      callId,
      ...(payload.microphoneEnabled !== undefined
        ? { microphoneEnabled: payload.microphoneEnabled }
        : {}),
      ...(payload.cameraEnabled !== undefined ? { cameraEnabled: payload.cameraEnabled } : {}),
      ...(payload.speakerEnabled !== undefined ? { speakerEnabled: payload.speakerEnabled } : {}),
    };
  }

  private async callOperation<T>(
    client: LatacheSocket,
    action: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const normalized = this.normalizeCallError(error);
      client.emit('call:error', {
        action,
        statusCode: normalized.statusCode,
        message: normalized.message,
        occurredAt: new Date().toISOString(),
      });
      throw new WsException({
        statusCode: normalized.statusCode,
        message: normalized.message,
      });
    }
  }

  private normalizeCallError(error: unknown): { statusCode: number; message: string } {
    if (error instanceof WsException) {
      const value = error.getError();
      if (typeof value === 'string') return { statusCode: 400, message: value };
      if (value && typeof value === 'object') {
        const object = value as { statusCode?: unknown; message?: unknown };
        return {
          statusCode: Number.isInteger(object.statusCode) ? Number(object.statusCode) : 400,
          message: String(object.message ?? 'Call request failed'),
        };
      }
      return { statusCode: 400, message: error.message };
    }
    if (error instanceof HttpException) {
      const response = error.getResponse();
      let message = error.message;
      if (typeof response === 'string') {
        message = response;
      } else if (response && typeof response === 'object' && 'message' in response) {
        const value = (response as { message?: unknown }).message;
        message = Array.isArray(value) ? value.map(String).join(', ') : String(value ?? message);
      }
      return { statusCode: error.getStatus(), message };
    }
    this.logger.error(
      'Unexpected call signaling error',
      error instanceof Error ? (error.stack ?? error.message) : String(error),
    );
    return { statusCode: 500, message: 'Call request failed' };
  }

  private assertCallSignalRate(client: LatacheSocket): void {
    const now = Date.now();
    const maximum = this.config.get<number>('chat.callSignalMaxPerMinute', 300);
    const current = this.signalRate.get(client.id);
    if (!current || now - current.startedAt >= 60_000) {
      this.signalRate.set(client.id, { startedAt: now, count: 1 });
      return;
    }
    current.count += 1;
    if (current.count > maximum) {
      throw new WsException('Call signaling rate limit exceeded');
    }
  }
}
