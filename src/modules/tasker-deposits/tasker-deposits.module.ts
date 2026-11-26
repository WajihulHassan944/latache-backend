import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { StripeService } from '../payments/stripe.service';
import { AdminTaskerDepositsController, TaskerDepositController } from './tasker-deposits.controller';
import { TaskerDepositsService } from './tasker-deposits.service';

@Module({
  imports: [AuthModule, AdminAuditModule, InvoicesModule, NotificationsModule, PlatformSettingsModule],
  controllers: [TaskerDepositController, AdminTaskerDepositsController],
  // StripeService is stateless (config only); providing it here avoids a module cycle with PaymentsModule.
  providers: [TaskerDepositsService, StripeService],
  exports: [TaskerDepositsService],
})
export class TaskerDepositsModule {}
