import { Global, Module } from '@nestjs/common';
import { RealtimeModule } from '../../modules/realtime/realtime.module';
import { TaskerFinanceModule } from '../../modules/tasker-finance/tasker-finance.module';
import { PerformanceJobsService } from './performance-jobs.service';
import { AccountDeletionModule } from '../../modules/account-deletion/account-deletion.module';

@Global()
@Module({
  imports: [TaskerFinanceModule, RealtimeModule, AccountDeletionModule],
  providers: [PerformanceJobsService],
  exports: [PerformanceJobsService],
})
export class PerformanceJobsModule {}
