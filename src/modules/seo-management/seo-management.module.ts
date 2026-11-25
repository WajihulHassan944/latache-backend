import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { LocalizationModule } from '../localization/localization.module';
import { SeoPublicController, AdminSeoController, SeoSearchConsoleCallbackController, SeoGoogleAnalyticsCallbackController } from './controllers/seo-management.controller';
import { SeoManagementService } from './services/seo-management.service';
import { SeoExtrasService } from './services/seo-extras.service';
import { SearchConsoleService } from './services/search-console.service';
import { GoogleAnalyticsService } from './services/google-analytics.service';

@Module({
  imports: [AuthModule, AdminAuditModule, LocalizationModule],
  controllers: [SeoPublicController, AdminSeoController, SeoSearchConsoleCallbackController, SeoGoogleAnalyticsCallbackController],
  providers: [SeoManagementService, SeoExtrasService, SearchConsoleService, GoogleAnalyticsService],
  exports: [SeoManagementService, SeoExtrasService, SearchConsoleService, GoogleAnalyticsService],
})
export class SeoManagementModule {}
