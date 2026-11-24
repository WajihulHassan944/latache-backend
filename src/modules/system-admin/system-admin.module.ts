import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { AuthModule } from '../auth/auth.module';
import { SystemAdminController } from './system-admin.controller';
import { SystemAdminService } from './system-admin.service';

// PerformanceJobsService comes from the @Global() PerformanceJobsModule.
@Module({
  imports: [AuthModule, AdminAuditModule],
  controllers: [SystemAdminController],
  providers: [SystemAdminService],
})
export class SystemAdminModule {}
