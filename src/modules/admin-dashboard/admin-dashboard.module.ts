import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminCustomersController } from './controllers/admin-customers.controller';
import { AdminTaskersController } from './controllers/admin-taskers.controller';
import { AdminBookingsController } from './controllers/admin-bookings.controller';
import { AdminDisputesController } from './controllers/admin-disputes.controller';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { AdminCustomersService } from './services/admin-customers.service';
import { AdminTaskersService } from './services/admin-taskers.service';
import { AdminBookingsService } from './services/admin-bookings.service';
import { AdminDisputesService } from './services/admin-disputes.service';

@Module({
  imports: [AuthModule, NotificationsModule, AdminAuditModule, PaymentsModule],
  controllers: [
    AdminAnalyticsController,
    AdminCustomersController,
    AdminTaskersController,
    AdminBookingsController,
    AdminDisputesController,
  ],
  providers: [
    AdminAnalyticsService,
    AdminCustomersService,
    AdminTaskersService,
    AdminBookingsService,
    AdminDisputesService,
  ],
})
export class AdminDashboardModule {}
