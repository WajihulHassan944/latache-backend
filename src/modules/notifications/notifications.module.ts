import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationTemplateService } from './notification-template.service';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationTemplateService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
