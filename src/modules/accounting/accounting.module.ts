import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { AccountingBooksService } from './accounting-books.service';
import { AccountingExportService } from './accounting-export.service';
import { AccountingPostingService } from './accounting-posting.service';
import { AccountingReportsService } from './accounting-reports.service';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

@Module({
  imports: [AuthModule, AdminAuditModule, PlatformSettingsModule, InvoicesModule],
  controllers: [AccountingController],
  providers: [AccountingBooksService, AccountingPostingService, AccountingReportsService, AccountingService, AccountingExportService],
  exports: [AccountingPostingService],
})
export class AccountingModule {}
