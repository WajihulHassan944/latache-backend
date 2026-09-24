import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StripeService } from '../payments/stripe.service';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PlatformPayableSettlementsService } from './platform-payable-settlements.service';
import { TaskerEarningsWorker } from './tasker-earnings.worker';
import { TaskerFinanceService } from './tasker-finance.service';

@Module({
  imports: [NotificationsModule, PlatformSettingsModule, RealtimeModule, AdminAuditModule],
  // StripeService is a stateless config-backed client; providing it here avoids
  // importing PaymentsModule, which itself depends on this module.
  providers: [TaskerFinanceService, TaskerEarningsWorker, PlatformPayableSettlementsService, StripeService],
  exports: [TaskerFinanceService, TaskerEarningsWorker, PlatformPayableSettlementsService],
})
export class TaskerFinanceModule {}
