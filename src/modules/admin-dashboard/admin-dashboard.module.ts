import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { PaymentsModule } from '../payments/payments.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminCustomersController } from './controllers/admin-customers.controller';
import { AdminTaskersController } from './controllers/admin-taskers.controller';
import { AdminBookingsController } from './controllers/admin-bookings.controller';
import { AdminDisputesController } from './controllers/admin-disputes.controller';
import { AdminReviewsController } from './controllers/admin-reviews.controller';
import { AdminAnalyticsService } from './services/admin-analytics.service';
import { AdminCustomersService } from './services/admin-customers.service';
import { AdminTaskersService } from './services/admin-taskers.service';
import { AdminBookingsService } from './services/admin-bookings.service';
import { AdminDisputesService } from './services/admin-disputes.service';
import { AdminReviewsService } from './services/admin-reviews.service';
import { AdminAnalyticsCacheInterceptor } from './admin-analytics-cache.interceptor';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    AdminAuditModule,
    PaymentsModule,
    RealtimeModule,
    AccountDeletionModule,
  ],
  controllers: [
    AdminAnalyticsController,
    AdminCustomersController,
    AdminTaskersController,
    AdminBookingsController,
    AdminDisputesController,
    AdminReviewsController,
  ],
  providers: [
    AdminAnalyticsService,
    AdminCustomersService,
    AdminTaskersService,
    AdminBookingsService,
    AdminDisputesService,
    AdminReviewsService,
    AdminAnalyticsCacheInterceptor,
  ],
})
export class AdminDashboardModule {}
