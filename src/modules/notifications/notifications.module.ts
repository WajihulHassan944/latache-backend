import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { BookingEventCardsService } from './booking-event-cards.service';
import { NotificationTemplateService } from './notification-template.service';
import { FcmModule } from '../fcm/fcm.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [AuthModule, RealtimeModule, FcmModule, MailModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationTemplateService, BookingEventCardsService],
  exports: [NotificationsService, BookingEventCardsService],
})
export class NotificationsModule {}
