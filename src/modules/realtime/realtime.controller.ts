import { Controller, Get, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RealtimeCallsService } from './realtime-calls.service';
import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_NAMESPACE,
  REALTIME_PATH,
  REALTIME_SERVER_EVENTS,
} from './realtime.constants';
import { WebRtcConfigService } from './webrtc-config.service';

@ApiTags('16 Realtime')
@ApiBearerAuth('bearer')
@UseGuards(JwtAuthGuard)
@Controller('realtime')
export class RealtimeController {
  constructor(
    private readonly config: ConfigService,
    private readonly calls: RealtimeCallsService,
    private readonly webRtc: WebRtcConfigService,
  ) {}

  @Get('session')
  @ApiOperation({
    summary: 'Get the authenticated realtime and WebRTC transport contract',
    description:
      'REST remains the write source for persisted notifications/messages. Socket.IO provides authenticated push delivery, read receipts, typing indicators, booking state, task timer, live location, and one-to-one WebRTC call signaling. Media is exchanged by the clients; the API does not record or proxy audio/video.',
  })
  session(@CurrentUser() user: User) {
    const calls = this.calls.capabilities();
    return {
      enabled: this.config.get<boolean>('realtime.enabled', true),
      namespace: REALTIME_NAMESPACE,
      path: REALTIME_PATH,
      transports: ['websocket'],
      authentication: {
        handshakeAuthKey: 'token',
        alternativeHeader: 'Authorization: Bearer <accessToken>',
      },
      identity: { userId: String(user.id), role: user.role },
      clientEvents: [...REALTIME_CLIENT_EVENTS],
      serverEvents: [...REALTIME_SERVER_EVENTS],
      delivery: {
        persistedEvents: 'at_least_once',
        transientEvents: [
          'conversation:typing',
          'support:typing',
          'call:offer',
          'call:answer',
          'call:ice_candidate',
          'call:media_state',
          'call:error',
          'realtime:error',
        ],
        deduplicatePersistedBy: 'eventId',
      },
      calls: {
        ...calls,
        iceConfiguration: this.webRtc.forUser(user.id),
        restHistory: {
          list: '/api/conversations/:bookingId/calls',
          detail: '/api/conversations/:bookingId/calls/:callId',
        },
      },
    };
  }
}
