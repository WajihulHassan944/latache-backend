import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import configuration from './config/configuration';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { HealthModule } from './modules/health/health.module';
import { ServicesModule } from './modules/services/services.module';
import { TaskersModule } from './modules/taskers/taskers.module';
import { UsersModule } from './modules/users/users.module';
import { UploadsModule } from './modules/uploads/uploads.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { TaskerDashboardModule } from './modules/tasker-dashboard/tasker-dashboard.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { FavoritesModule } from './modules/favorites/favorites.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { AdminDashboardModule } from './modules/admin-dashboard/admin-dashboard.module';
import { EliteProgramModule } from './modules/elite-program/elite-program.module';
import { PlatformSettingsModule } from './modules/platform-settings/platform-settings.module';
import { AdminFinanceModule } from './modules/admin-finance/admin-finance.module';
import { SupportModule } from './modules/support/support.module';
import { AdminServicesModule } from './modules/admin-services/admin-services.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { TaskerFinanceModule } from './modules/tasker-finance/tasker-finance.module';
import { LocalizationModule } from './modules/localization/localization.module';
import { LocaleInterceptor } from './modules/localization/locale.interceptor';
import { RedisModule } from './infrastructure/redis/redis.module';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { RequestLoggingInterceptor } from './infrastructure/observability/request-logging.interceptor';
import { PerformanceJobsModule } from './infrastructure/jobs/performance-jobs.module';
import { ReferralsModule } from './modules/referrals/referrals.module';
import { ContentManagementModule } from './modules/content-management/content-management.module';
import { SeoManagementModule } from './modules/seo-management/seo-management.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: [configuration],
      validate: validateEnvironment,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 120,
      },
    ]),
    ObservabilityModule,
    DatabaseModule,
    RedisModule,
    LocalizationModule,
    UsersModule,
    AuthModule,
    ServicesModule,
    TaskersModule,
    BookingsModule,
    UploadsModule,
    RbacModule,
    TaskerDashboardModule,
    DashboardModule,
    AdminDashboardModule,
    EliteProgramModule,
    PlatformSettingsModule,
    AdminFinanceModule,
    AdminServicesModule,
    SupportModule,
    RealtimeModule,
    TaskerFinanceModule,
    NotificationsModule,
    ConversationsModule,
    ReviewsModule,
    PaymentsModule,
    FavoritesModule,
    ReferralsModule,
    ContentManagementModule,
    SeoManagementModule,
    HealthModule,
    PerformanceJobsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: LocaleInterceptor },
    { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor },
  ],
})
export class AppModule {}
