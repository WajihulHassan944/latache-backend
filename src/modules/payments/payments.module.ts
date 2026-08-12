import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { TaskerFinanceModule } from '../tasker-finance/tasker-finance.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { StripeWebhooksController } from './stripe-webhooks.controller';
import { StripeService } from './stripe.service';

@Module({
  imports: [AuthModule, NotificationsModule, PlatformSettingsModule, TaskerFinanceModule],
  controllers: [PaymentsController, StripeWebhooksController],
  providers: [StripeService, PaymentsService],
  exports: [PaymentsService, StripeService],
})
export class PaymentsModule {}
