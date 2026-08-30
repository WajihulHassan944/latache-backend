import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { LocalizationModule } from '../localization/localization.module';
import { PublicHomepageContentController, ContentManagementController, AdminContentManagementController } from './controllers/content-management.controller';
import { ContentManagementService } from './services/content-management.service';

@Module({
  imports: [AuthModule, AdminAuditModule, LocalizationModule],
  controllers: [PublicHomepageContentController, ContentManagementController, AdminContentManagementController],
  providers: [ContentManagementService],
  exports: [ContentManagementService],
})
export class ContentManagementModule {}
