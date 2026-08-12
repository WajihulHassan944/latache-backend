import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { TaskerFinanceModule } from '../tasker-finance/tasker-finance.module';
import { AdminFinanceController } from './controllers/admin-finance.controller';
import { AdminFinanceService } from './services/admin-finance.service';

@Module({
  imports: [
    AuthModule,
    AdminAuditModule,
    NotificationsModule,
    PlatformSettingsModule,
    TaskerFinanceModule,
  ],
  controllers: [AdminFinanceController],
  providers: [AdminFinanceService],
})
export class AdminFinanceModule {}
