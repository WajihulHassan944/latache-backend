import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { MailModule } from '../mail/mail.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { UploadsModule } from '../uploads/uploads.module';
import { DisputeLifecycleService } from './dispute-lifecycle.service';

@Module({
  imports: [
    AdminAuditModule,
    MailModule,
    NotificationsModule,
    PlatformSettingsModule,
    UploadsModule,
  ],
  providers: [DisputeLifecycleService],
  exports: [DisputeLifecycleService],
})
export class DisputesModule {}
