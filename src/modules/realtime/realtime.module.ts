import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeCallsService } from './realtime-calls.service';
import { RealtimeController } from './realtime.controller';
import { RealtimeDispatcherService } from './realtime-dispatcher.service';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeOutboxService } from './realtime-outbox.service';
import { WebRtcConfigService } from './webrtc-config.service';

@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [
    RealtimeGateway,
    RealtimeOutboxService,
    RealtimeDispatcherService,
    RealtimeCallsService,
    WebRtcConfigService,
  ],
  exports: [
    RealtimeOutboxService,
    RealtimeCallsService,
    RealtimeDispatcherService,
    WebRtcConfigService,
  ],
})
export class RealtimeModule {}
