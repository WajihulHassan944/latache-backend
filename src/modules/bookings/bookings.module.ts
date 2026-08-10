import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { TaskerDashboardModule } from '../tasker-dashboard/tasker-dashboard.module';
import { BookingDiscoveryController, BookingsController } from './bookings.controller';
import { BookingsRepository } from './bookings.repository';
import { BookingsService } from './bookings.service';

@Module({
  imports: [AuthModule, NotificationsModule, PaymentsModule, TaskerDashboardModule, PlatformSettingsModule],
  controllers: [BookingDiscoveryController, BookingsController],
  providers: [BookingsService, BookingsRepository],
  exports: [BookingsService],
})
export class BookingsModule {}
