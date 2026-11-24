import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';
import { MailModule } from '../mail/mail.module';
import { AdminInvoicesController, InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { TaskerStatementsService } from './tasker-statements.service';
import { AdminTaskerStatementsController, TaskerStatementsController } from './tasker-statements.controller';

@Module({
  imports: [AuthModule, PlatformSettingsModule, MailModule],
  controllers: [InvoicesController, AdminInvoicesController, TaskerStatementsController, AdminTaskerStatementsController],
  providers: [InvoicesService, TaskerStatementsService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
