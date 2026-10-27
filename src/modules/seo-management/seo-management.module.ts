import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { LocalizationModule } from '../localization/localization.module';
import { SeoPublicController, AdminSeoController, SeoSearchConsoleCallbackController } from './controllers/seo-management.controller';
import { SeoManagementService } from './services/seo-management.service';
import { SearchConsoleService } from './services/search-console.service';

@Module({
  imports: [AuthModule, AdminAuditModule, LocalizationModule],
  controllers: [SeoPublicController, AdminSeoController, SeoSearchConsoleCallbackController],
  providers: [SeoManagementService, SearchConsoleService],
  exports: [SeoManagementService, SearchConsoleService],
})
export class SeoManagementModule {}
