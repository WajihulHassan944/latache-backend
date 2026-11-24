import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AdminConversationsController } from './admin-conversations.controller';
import { AdminConversationsService } from './admin-conversations.service';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [AuthModule, AdminAuditModule, NotificationsModule, RealtimeModule, UploadsModule],
  controllers: [ConversationsController, AdminConversationsController],
  providers: [ConversationsService, AdminConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
