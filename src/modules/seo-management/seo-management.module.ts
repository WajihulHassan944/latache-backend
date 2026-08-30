import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { LocalizationModule } from '../localization/localization.module';
import { SeoPublicController, AdminSeoController } from './controllers/seo-management.controller';
import { SeoManagementService } from './services/seo-management.service';

@Module({
  imports: [AuthModule, AdminAuditModule, LocalizationModule],
  controllers: [SeoPublicController, AdminSeoController],
  providers: [SeoManagementService],
  exports: [SeoManagementService],
})
export class SeoManagementModule {}
