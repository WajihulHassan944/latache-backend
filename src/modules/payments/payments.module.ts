import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { TaskerFinanceModule } from '../tasker-finance/tasker-finance.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { DisputesModule } from '../disputes/disputes.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeWebhooksController } from './stripe-webhooks.controller';
import { StripeService } from './stripe.service';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { PayoutDataSecurityService } from '../tasker-dashboard/services/payout-data-security.service';
import { AdminCustomerWithdrawalsController } from './admin-customer-withdrawals.controller';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    PlatformSettingsModule,
    TaskerFinanceModule,
    ReferralsModule,
    DisputesModule,
    RealtimeModule,
    AdminAuditModule,
  ],
  controllers: [PaymentsController, StripeWebhooksController, AdminCustomerWithdrawalsController],
  providers: [StripeService, PaymentsService, PayoutDataSecurityService],
  exports: [PaymentsService, StripeService],
})
export class PaymentsModule {}
