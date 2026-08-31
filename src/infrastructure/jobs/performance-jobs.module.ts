import { Global, Module } from '@nestjs/common';
import { RealtimeModule } from '../../modules/realtime/realtime.module';
import { TaskerFinanceModule } from '../../modules/tasker-finance/tasker-finance.module';
import { PerformanceJobsService } from './performance-jobs.service';
import { AccountDeletionModule } from '../../modules/account-deletion/account-deletion.module';
import { BookingsModule } from '../../modules/bookings/bookings.module';
import { ReferralsModule } from '../../modules/referrals/referrals.module';
import { DisputesModule } from '../../modules/disputes/disputes.module';
import { EliteProgramModule } from '../../modules/elite-program/elite-program.module';
import { NotificationsModule } from '../../modules/notifications/notifications.module';
import { FcmModule } from '../../modules/fcm/fcm.module';

@Global()
@Module({
  imports: [
    TaskerFinanceModule,
    RealtimeModule,
    AccountDeletionModule,
    BookingsModule,
    ReferralsModule,
    DisputesModule,
    EliteProgramModule,
    NotificationsModule,
    FcmModule,
  ],
  providers: [PerformanceJobsService],
  exports: [PerformanceJobsService],
})
export class PerformanceJobsModule {}
