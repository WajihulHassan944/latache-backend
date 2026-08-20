import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { TaskerDashboardModule } from '../tasker-dashboard/tasker-dashboard.module';
import { CustomerDashboardService } from './customer-dashboard.service';
import { DashboardController } from './dashboard.controller';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

@Module({
  imports: [AuthModule, ReviewsModule, TaskerDashboardModule, PlatformSettingsModule],
  controllers: [DashboardController],
  providers: [CustomerDashboardService],
})
export class DashboardModule {}
