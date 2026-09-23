import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsModule } from '../payments/payments.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { TaskerDashboardModule } from '../tasker-dashboard/tasker-dashboard.module';
import { TaskerFinanceModule } from '../tasker-finance/tasker-finance.module';
import { BookingDiscoveryController, BookingsController } from './bookings.controller';
import { ParticipantDisputesController } from './participant-disputes.controller';
import { BookingsRepository } from './bookings.repository';
import { BookingsService } from './bookings.service';
import { BookingWorkVerificationService } from './booking-work-verification.service';
import { CustomTimeRequestsController } from './custom-time-requests.controller';
import { CustomTimeRequestsService } from './custom-time-requests.service';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { DisputesModule } from '../disputes/disputes.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    PaymentsModule,
    TaskerDashboardModule,
    TaskerFinanceModule,
    PlatformSettingsModule,
    RealtimeModule,
    AdminAuditModule,
    ConversationsModule,
    DisputesModule,
    ReferralsModule,
    UploadsModule,
  ],
  controllers: [
    BookingDiscoveryController,
    BookingsController,
    ParticipantDisputesController,
    CustomTimeRequestsController,
  ],
  providers: [
    BookingsService,
    BookingsRepository,
    BookingWorkVerificationService,
    CustomTimeRequestsService,
  ],
  exports: [BookingsService, CustomTimeRequestsService],
})
export class BookingsModule {}
