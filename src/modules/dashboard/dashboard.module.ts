import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TaskerDashboardModule } from '../tasker-dashboard/tasker-dashboard.module';
import { CustomerDashboardService } from './customer-dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [AuthModule, ReviewsModule, TaskerDashboardModule],
  controllers: [DashboardController],
  providers: [CustomerDashboardService],
})
export class DashboardModule {}
