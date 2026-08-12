import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { TaskerEarningsWorker } from './tasker-earnings.worker';
import { TaskerFinanceService } from './tasker-finance.service';

@Module({
  imports: [NotificationsModule, PlatformSettingsModule],
  providers: [TaskerFinanceService, TaskerEarningsWorker],
  exports: [TaskerFinanceService, TaskerEarningsWorker],
})
export class TaskerFinanceModule {}
