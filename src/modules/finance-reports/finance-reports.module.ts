import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { FinanceReportsController } from './finance-reports.controller';
import { FinanceReportsService } from './finance-reports.service';
import { ReconciliationService } from './reconciliation.service';
import { PaymentsModule } from '../payments/payments.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

@Module({
  imports: [AuthModule, AdminAuditModule, PaymentsModule, PlatformSettingsModule],
  controllers: [FinanceReportsController],
  providers: [FinanceReportsService, ReconciliationService],
})
export class FinanceReportsModule {}
