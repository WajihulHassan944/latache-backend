import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { GuestModule } from '../guest/guest.module';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

@Module({
  imports: [AuthModule, GuestModule, AdminAuditModule, AccountDeletionModule, PlatformSettingsModule],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
