import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { AdminTaskerDepositsController, TaskerDepositController } from './tasker-deposits.controller';
import { TaskerDepositsService } from './tasker-deposits.service';

@Module({
  imports: [AuthModule, AdminAuditModule, InvoicesModule, NotificationsModule, PlatformSettingsModule],
  controllers: [TaskerDepositController, AdminTaskerDepositsController],
  providers: [TaskerDepositsService],
  exports: [TaskerDepositsService],
})
export class TaskerDepositsModule {}
