import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationTemplateService } from './notification-template.service';
import { FcmModule } from '../fcm/fcm.module';

@Module({
  imports: [AuthModule, RealtimeModule, FcmModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationTemplateService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
