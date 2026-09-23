import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { AdminTaskerPlansController } from './admin-tasker-plans.controller';
import { TaskerPlansController } from './tasker-plans.controller';
import { TaskerPlansService } from './tasker-plans.service';

@Module({
  imports: [AuthModule, AdminAuditModule, NotificationsModule, PaymentsModule, PlatformSettingsModule],
  controllers: [TaskerPlansController, AdminTaskerPlansController],
  providers: [TaskerPlansService],
  exports: [TaskerPlansService],
})
export class TaskerPlansModule {}
