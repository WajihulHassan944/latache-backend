import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { AdminServicesController } from './controllers/admin-services.controller';
import { AdminServicesService } from './services/admin-services.service';

@Module({
  imports: [AuthModule, PlatformSettingsModule],
  controllers: [AdminServicesController],
  providers: [AdminServicesService],
})
export class AdminServicesModule {}
