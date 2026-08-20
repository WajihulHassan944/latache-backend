import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TaskerFinanceModule } from '../tasker-finance/tasker-finance.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { TaskerProfileController } from './controllers/tasker-profile.controller';
import { TaskerWalletController } from './controllers/tasker-wallet.controller';
import { PayoutDataSecurityService } from './services/payout-data-security.service';
import { TaskerDashboardService } from './services/tasker-dashboard.service';
import { TaskerProfileService } from './services/tasker-profile.service';
import { TaskerTasksService } from './services/tasker-tasks.service';
import { TaskerWalletService } from './services/tasker-wallet.service';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    ReviewsModule,
    RealtimeModule,
    TaskerFinanceModule,
    PlatformSettingsModule,
    AdminAuditModule,
    ReferralsModule,
  ],
  controllers: [TaskerProfileController, TaskerWalletController],
  providers: [
    PayoutDataSecurityService,
    TaskerWalletService,
    TaskerTasksService,
    TaskerProfileService,
    TaskerDashboardService,
  ],
  exports: [TaskerWalletService, TaskerTasksService, TaskerDashboardService],
})
export class TaskerDashboardModule {}
