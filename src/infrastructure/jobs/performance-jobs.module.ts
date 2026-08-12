import { Global, Module } from '@nestjs/common';
import { RealtimeModule } from '../../modules/realtime/realtime.module';
import { TaskerFinanceModule } from '../../modules/tasker-finance/tasker-finance.module';
import { PerformanceJobsService } from './performance-jobs.service';

@Global()
@Module({
  imports: [TaskerFinanceModule, RealtimeModule],
  providers: [PerformanceJobsService],
  exports: [PerformanceJobsService],
})
export class PerformanceJobsModule {}
