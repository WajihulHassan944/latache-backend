import { Module } from '@nestjs/common';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { UploadsModule } from '../uploads/uploads.module';
import { AccountDeletionService } from './account-deletion.service';
import { ObjectStorageDeletionService } from './object-storage-deletion.service';

@Module({
  imports: [AdminAuditModule, UploadsModule],
  providers: [AccountDeletionService, ObjectStorageDeletionService],
  exports: [AccountDeletionService, ObjectStorageDeletionService],
})
export class AccountDeletionModule {}
