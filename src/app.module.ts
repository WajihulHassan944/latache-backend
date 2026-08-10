import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
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
    DatabaseModule,
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
    NotificationsModule,
    ConversationsModule,
    ReviewsModule,
    PaymentsModule,
    FavoritesModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
