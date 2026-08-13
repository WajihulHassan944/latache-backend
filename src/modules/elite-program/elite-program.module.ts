import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminAuditModule } from '../admin-audit/admin-audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminEliteTaskersController } from './controllers/admin-elite-taskers.controller';
import { TaskerEliteController } from './controllers/tasker-elite.controller';
import { EliteProgramService } from './services/elite-program.service';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';

@Module({
  imports: [AuthModule, AdminAuditModule, NotificationsModule, AccountDeletionModule],
  controllers: [AdminEliteTaskersController, TaskerEliteController],
  providers: [EliteProgramService],
  exports: [EliteProgramService],
})
export class EliteProgramModule {}
