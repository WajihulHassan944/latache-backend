import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AdminReferralsController } from './controllers/admin-referrals.controller';
import { ReferralsController } from './controllers/referrals.controller';
import { ReferralRewardsWorker } from './referral-rewards.worker';
import { ReferralsService } from './services/referrals.service';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    PlatformSettingsModule,
    RealtimeModule,
    AdminAuditModule,
  ],
  controllers: [ReferralsController, AdminReferralsController],
  providers: [ReferralsService, ReferralRewardsWorker],
  exports: [ReferralsService, ReferralRewardsWorker],
})
export class ReferralsModule {}
